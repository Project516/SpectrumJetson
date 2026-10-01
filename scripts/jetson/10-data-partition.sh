#!/usr/bin/env bash
# Creates the two data partitions in the SSD space the flash left free (02-flash-nvme.sh gives the
# system ~64 GiB), and mounts everything the Jetson writes while running onto them, so the
# system partition is only written by updates. Run ON THE JETSON, once after the flash (safe to
# re-run: it only creates what's missing, and moves existing files across, never deletes them).
#
#   SPECTRUM_SETTINGS (2 GiB)  PhotonVision's database, calibrations, field calibration, snapshots,
#                              the robot-state file. Written only when a setting changes. Mounted
#                              sync + data=journal: each change reaches the SSD at once, contents
#                              journaled too, not just the filesystem structure.
#   SPECTRUM_SCRATCH (the rest) Rewind recordings, PhotonVision's logs, the system log. Written
#                              all the time; expendable, but never wiped automatically.
#
# Both are mounted "nofail": if a power cut damages one so badly that fsck can't repair it at
# boot, the Jetson still boots, and spectrum-data-fallback.sh (installed here, runs before
# PhotonVision) puts something safe in its place so the match still runs:
#   scratch missing:  logs to RAM, Rewind doesn't record.
#   settings missing: PhotonVision runs on the last-good settings committed to the system
#                     partition (--commit-settings), changes not kept; defaults if none.
# health-check.sh and Match Ready report it. Nothing is ever reformatted unless a person runs
#   10-data-partition.sh --reformat-scratch   (or --reformat-settings)
#
# Usage: 10-data-partition.sh [--status | --commit-settings | --reformat-scratch | --reformat-settings]
set -euo pipefail
DISK=/dev/nvme0n1
SETTINGS_SIZE=${SETTINGS_SIZE:-2GiB}
SET_LABEL=SPECTRUM_SETTINGS
SCR_LABEL=SPECTRUM_SCRATCH
SET=/data/settings
SCR=/data/scratch
PV=/opt/photonvision
FSTAB_TAG="# SpectrumJetson data partitions (10-data-partition.sh)"

sudo -n true 2>/dev/null || sudo -v

# What lives where: "partition-relative dir|mount point". Order matters: logs is inside
# photonvision_config, so it's bound after it.
BINDS=(
  "$SET/photonvision_config|$PV/photonvision_config"
  "$SET/snapshots|$PV/snapshots"
  "$SET/fieldcal|$PV/fieldcal"
  "$SCR/pv-logs|$PV/photonvision_config/logs"
  "$SCR/rewind|$PV/rewind"
  "$SCR/journal|/var/log/journal"
)
STATE_FILE=spectrum-robot-state.json   # a single file, bound from $SET
LAST_GOOD=$PV/.last-good-settings      # on the system partition: the settings fallback

status() {
  for m in "$SET" "$SCR" "$PV/photonvision_config" "$PV/photonvision_config/logs" "$PV/rewind" \
           "$PV/snapshots" "$PV/fieldcal" "$PV/$STATE_FILE" /var/log/journal; do
    if findmnt -n "$m" >/dev/null; then echo "mounted     $m ($(findmnt -n -o SOURCE "$m"))"
    else echo "NOT MOUNTED $m"; fi
  done
  echo "fallback: $(cat /run/spectrum-data-status 2>/dev/null || echo 'not run this boot')"
  if [[ -d $LAST_GOOD ]]; then echo "last-good settings: committed $(cat "$LAST_GOOD/.committed" 2>/dev/null)"
  else echo "last-good settings: none committed (run $0 --commit-settings)"; fi
}
[[ ${1:-} == --status ]] && { status; exit 0; }

# Copies the settings partition to the system partition as the fallback for a match where the
# settings partition won't mount. Run after tuning, while the system partition is writable
# (ro-root on does it for you).
commit_settings() {
  findmnt -n "$SET" >/dev/null || { echo "$SET isn't mounted: nothing to commit" >&2; exit 1; }
  # With the read-only system on, the copy would land in the RAM layer and vanish at the next boot.
  if [[ $(findmnt -n -o FSTYPE /) == overlay ]]; then
    echo "STOP: the system partition is read-only (ro-root on), so a commit wouldn't be kept." >&2
    echo "      ro-root.sh off (reboots), then ro-root.sh on: it commits on the way." >&2
    exit 1
  fi
  local db=$SET/photonvision_config/photon.sqlite new=$LAST_GOOD.new old=$LAST_GOOD.old
  sudo rm -rf "$new" "$old"
  sudo mkdir -p "$new/photonvision_config"
  # Built beside the old copy and swapped in with renames, so a power cut mid-commit leaves the old
  # copy or the new one, never half of each. The database is copied with SQLite's backup (a
  # consistent copy while PhotonVision may be writing it), the rest with rsync.
  sudo rsync -a --exclude photonvision_config/logs --exclude 'photon.sqlite*' "$SET/" "$new/"
  if sudo test -f "$db"; then   # sudo: /data is root-only, so a plain -f test never sees it
    sudo python3 -c 'import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close()' \
      "$db" "$new/photonvision_config/photon.sqlite"
  fi
  sudo test -f "$new/photonvision_config/photon.sqlite" || { echo "STOP: couldn't copy $db" >&2; sudo rm -rf "$new"; exit 1; }
  date '+%Y-%m-%d %H:%M' | sudo tee "$new/.committed" >/dev/null
  sync
  [[ -d $LAST_GOOD ]] && sudo mv "$LAST_GOOD" "$old"
  sudo mv "$new" "$LAST_GOOD"
  sync
  sudo rm -rf "$old"
  echo "Committed the current settings as the fallback ($(sudo du -sh "$LAST_GOOD" | cut -f1))."
}
[[ ${1:-} == --commit-settings ]] && { commit_settings; exit 0; }

# By GPT partition name (PARTLABEL, up to 36 characters), not the ext4 label: ext4 labels stop at
# 16 characters, and SPECTRUM_SETTINGS (17) was silently cut short, so a LABEL= mount never matched.
# Only on $DISK, so a second disk with the same names (a cloned SSD in a USB enclosure) is never
# picked; two matches on $DISK stop the script. The partition may have no filesystem yet.
part_of() {
  local found; found=$(lsblk -nrpo PATH,PARTLABEL "$DISK" 2>/dev/null | awk -v l="$1" '$2 == l {print $1}')
  if [[ $(wc -l <<<"$found") -gt 1 ]]; then
    echo "STOP: more than one partition named $1 on $DISK: $(tr '\n' ' ' <<<"$found")" >&2; exit 1
  fi
  echo "$found"
}
has_fs() { [[ -n $(sudo blkid -p -s TYPE -o value "$1" 2>/dev/null) ]]; }   # -p: read the disk, not blkid's cache

reformat() {  # $1 label, $2 mount point
  local dev; dev=$(part_of "$1")
  [[ -n $dev ]] || { echo "No partition labelled $1" >&2; exit 1; }
  echo "Reformatting $dev ($1). Everything on it is erased. Ctrl-C within 10 s to stop."
  sleep 10
  sudo systemctl stop photonvision 2>/dev/null || true
  findmnt -R -n -o TARGET "$2" | sort -r | xargs -r -n1 sudo umount -l
  for b in "${BINDS[@]}"; do [[ ${b%%|*} == "$2"/* ]] && sudo umount -l "${b##*|}" 2>/dev/null || true; done
  sudo mkfs.ext4 -q -F -L "$1" "$dev"
  sudo mount "$2"
  echo "Reformatted. Re-run $0 to recreate its folders and mounts, then start PhotonVision."
  exit 0
}
[[ ${1:-} == --reformat-scratch ]] && reformat "$SCR_LABEL" "$SCR"
[[ ${1:-} == --reformat-settings ]] && reformat "$SET_LABEL" "$SET"
[[ -z ${1:-} ]] || { echo "usage: $0 [--status | --commit-settings | --reformat-scratch | --reformat-settings]" >&2; exit 2; }

echo "==> 1. Partitions"
if [[ -z $(part_of $SET_LABEL) || -z $(part_of $SCR_LABEL) ]]; then
  command -v sgdisk >/dev/null || sudo apt-get install -y gdisk >/dev/null
  # The flash wrote the backup GPT where it was told the SSD ends; move it to the real end first.
  sudo sgdisk -e "$DISK" >/dev/null
  free_mib=$(( $(sudo sgdisk -p "$DISK" | awk '/Total free space/ {print $5}') * 512 / 1048576 ))
  echo "    free space: $free_mib MiB"
  (( free_mib > 8192 )) || { echo "Less than 8 GiB free on $DISK: flash with ROOTFS_SIZE=64GiB (02-flash-nvme.sh) first." >&2; exit 1; }
  if [[ -z $(part_of $SET_LABEL) ]]; then
    sudo sgdisk -n "0:0:+${SETTINGS_SIZE%iB}" -c "0:$SET_LABEL" -t 0:8300 "$DISK" >/dev/null
  fi
  if [[ -z $(part_of $SCR_LABEL) ]]; then
    sudo sgdisk -n "0:0:0" -c "0:$SCR_LABEL" -t 0:8300 "$DISK" >/dev/null
  fi
  sudo partprobe "$DISK"; sudo udevadm settle
  for label in $SET_LABEL $SCR_LABEL; do
    dev=""
    for _ in $(seq 20); do dev=$(part_of $label); [[ -n $dev ]] && break; sleep 0.5; done
    [[ -n $dev ]] || { echo "STOP: the new $label partition didn't appear on $DISK" >&2; exit 1; }
    # Only a partition with no filesystem: one that has one (an earlier run) is never reformatted.
    has_fs "$dev" && continue
    sudo mkfs.ext4 -q -L "${label:0:16}" "$dev"
  done
  sudo udevadm settle
fi
lsblk -o NAME,SIZE,LABEL,PARTLABEL "$DISK" | sed 's/^/    /'

echo "==> 2. Mounts (fstab)"
# The partitions: nofail so a damaged one never stops the boot; fsck at boot (pass 2) repairs
# what it can. The binds wait for their partition and are also nofail.
TMP=$(mktemp)
grep -v -F "$FSTAB_TAG" /etc/fstab | grep -v "x-spectrum-data" > "$TMP" || true
{
  echo "$FSTAB_TAG"
  echo "PARTLABEL=$SET_LABEL $SET ext4 defaults,noatime,sync,data=journal,nofail,x-systemd.device-timeout=10s,x-spectrum-data 0 2"
  echo "PARTLABEL=$SCR_LABEL $SCR ext4 defaults,noatime,nofail,x-systemd.device-timeout=10s,x-spectrum-data 0 2"
  for b in "${BINDS[@]}"; do
    src=${b%%|*} dst=${b##*|}
    echo "$src $dst none bind,nofail,x-systemd.requires-mounts-for=${src%/*},x-spectrum-data 0 0"
  done
  echo "$SET/$STATE_FILE $PV/$STATE_FILE none bind,nofail,x-systemd.requires-mounts-for=$SET,x-spectrum-data 0 0"
} >> "$TMP"
sudo install -m 644 "$TMP" /etc/fstab; rm -f "$TMP"
sudo systemctl daemon-reload
sudo mkdir -p "$SET" "$SCR"
findmnt -n "$SET" >/dev/null || sudo mount "$SET"
findmnt -n "$SCR" >/dev/null || sudo mount "$SCR"
# nofail makes mount report success even when the partition isn't found, and binding onto an
# unmounted $SET would put the settings on the system partition. Check, and stop if not.
for m in "$SET" "$SCR"; do
  [[ $(findmnt -n -o SOURCE "$m") == /dev/nvme* ]] || { echo "STOP: $m didn't mount its partition (findmnt: $(findmnt -n -o SOURCE "$m" || echo none))" >&2; exit 1; }
done

echo "==> 3. Move existing files across, then bind"
PV_WAS_RUNNING=0
systemctl is-active --quiet photonvision && { PV_WAS_RUNNING=1; sudo systemctl stop photonvision; }
JOURNAL_MOVED=0
for b in "${BINDS[@]}"; do
  src=${b%%|*} dst=${b##*|}
  sudo mkdir -p "$src" "$dst"
  if ! findmnt -n "$dst" >/dev/null; then
    # Anything already at the mount point (a fresh install's files) moves to the partition first,
    # so binding over it hides nothing. rsync --remove-source-files never deletes the only copy.
    if [[ -n $(sudo ls -A "$dst" 2>/dev/null) ]]; then
      [[ $dst == /var/log/journal ]] && JOURNAL_MOVED=1
      sudo rsync -a --remove-source-files "$dst/" "$src/"
      sudo find "$dst" -mindepth 1 -type d -empty -delete
    fi
    sudo mount "$dst"
  fi
done
if ! findmnt -n "$PV/$STATE_FILE" >/dev/null; then
  if [[ -f $PV/$STATE_FILE && ! -f $SET/$STATE_FILE ]]; then sudo cp -a "$PV/$STATE_FILE" "$SET/$STATE_FILE"; fi
  [[ -f $SET/$STATE_FILE ]] || echo '{}' | sudo tee "$SET/$STATE_FILE" >/dev/null
  [[ -f $PV/$STATE_FILE ]] || sudo touch "$PV/$STATE_FILE"
  sudo mount "$PV/$STATE_FILE"
fi
[[ $JOURNAL_MOVED == 1 ]] && sudo systemctl restart systemd-journald
[[ $PV_WAS_RUNNING == 1 ]] && sudo systemctl start photonvision

echo "==> 4. Fallback for a damaged partition (runs at every boot, before PhotonVision)"
sudo install -m 755 "$(dirname "$0")/spectrum-data-fallback.sh" /usr/local/bin/spectrum-data-fallback
# Quiet mode's helper (photonvision-56): PhotonVision runs it to stop and start writing to scratch.
sudo install -m 755 "$(dirname "$0")/spectrum-quiet.sh" /usr/local/bin/spectrum-quiet
# It must wait for the data mounts to finish, whether they work or fail: "nofail" mounts aren't
# ordered before local-fs.target, so without these lines it could run while fsck is still repairing
# a partition after a power cut, and put its stand-ins over a partition about to mount. After= is
# ordering only: a mount that fails (or whose device never appears, 10 s) doesn't stop it.
MOUNT_UNITS=$(for m in "$SET" "$SCR" "${BINDS[@]##*|}" "$PV/$STATE_FILE"; do systemd-escape -p --suffix=mount "$m"; done | tr '\n' ' ')
sudo tee /etc/systemd/system/spectrum-data-fallback.service >/dev/null <<UNIT
[Unit]
Description=SpectrumJetson: stand-ins for a data partition that didn't mount (10-data-partition.sh)
DefaultDependencies=no
After=local-fs.target $MOUNT_UNITS
Before=photonvision.service systemd-journal-flush.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/bin/spectrum-data-fallback

[Install]
WantedBy=multi-user.target
UNIT
sudo mkdir -p /etc/systemd/system/photonvision.service.d
sudo tee /etc/systemd/system/photonvision.service.d/20-spectrum-data.conf >/dev/null <<'UNIT'
# SpectrumJetson (10-data-partition.sh): start after the data partitions, or their stand-ins.
[Unit]
Wants=spectrum-data-fallback.service
After=spectrum-data-fallback.service
UNIT
sudo systemctl daemon-reload
sudo systemctl enable spectrum-data-fallback.service
sudo systemctl restart spectrum-data-fallback.service

echo "==> 5. Status"
status
