#!/usr/bin/env bash
# Back up the whole Jetson SSD to this laptop, plus PhotonVision's settings export. Restore it
# with 05-restore-ssd.sh, onto the same SSD or a blank spare.
#
# Uses NVIDIA's backup tool (Linux_for_Tegra/tools/backup_restore): the Jetson boots a small
# system over the USB-C cable in Force Recovery Mode, and the SSD's partitions are copied to the
# laptop (the main partition as a compressed archive of its files, so the backup is only a few
# GB). About 10-20 minutes.
#
# Rewind recordings are part of the SSD, so they'd be in the backup. This refuses to run while
# there are more than 1 GB of them: download what you want, delete them in the UI, then back up
# (or pass --include-recordings).
#
# While it runs, this temporarily (reverted on exit):
#   - tells NetworkManager to leave the Jetson's USB network interface alone,
#   - allows the flash tool's IPv6 subnet (fc00:1:1::/48) through ufw,
#   - stops udisks2 (NVIDIA's tool needs automount off).
#
# Run as your normal user; it uses sudo where needed.
# Usage: 04-backup-ssd.sh [--include-recordings]
# Output: $BACKUP_ROOT/<date>/ (default ~/jetson-backups)
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
source "$REPO_ROOT/config.env"
BACKUP_ROOT=${BACKUP_ROOT:-$HOME/jetson-backups}
JETSON_IP=${JETSON_IP:-192.168.55.1}
KEY=${KEY:-$HOME/.ssh/jetson_ed25519}
IMAGES=$L4T_DIR/tools/backup_restore/images

if [[ $EUID -eq 0 ]]; then
  echo "Run this as your normal user, not root. It will sudo when needed." >&2
  exit 1
fi
[[ -x $L4T_DIR/tools/backup_restore/l4t_backup_restore.sh ]] \
  || { echo "No BSP at $L4T_DIR. Run scripts/host/01-prepare-bsp.sh first." >&2; exit 1; }
if [[ -e $IMAGES ]]; then
  echo "$IMAGES already exists (a previous backup or restore that didn't finish?)." >&2
  echo "Move it out of the way first." >&2
  exit 1
fi

STAMP=$(date +%Y%m%d-%H%M%S)
OUT=$BACKUP_ROOT/$STAMP
mkdir -p "$OUT"

# 1. While the Jetson is still running: settings export and a record of what's on it.
if lsusb -d "$RCM_USB_ID" >/dev/null; then
  echo "==> The Jetson is already in Force Recovery Mode: skipping the settings export."
else
  SSH=(ssh -i "$KEY" -o ConnectTimeout=5 -o BatchMode=yes "$JETSON_USER@$JETSON_IP")
  "${SSH[@]}" true 2>/dev/null \
    || { echo "Can't reach the Jetson at $JETSON_IP (is the USB-C cable in?)." >&2; exit 1; }
  rec_mb=$("${SSH[@]}" 'du -sm /opt/photonvision/rewind/sessions 2>/dev/null | cut -f1' || echo 0)
  if [[ ${rec_mb:-0} -gt 1000 && ${1:-} != --include-recordings ]]; then
    echo "The Jetson has ${rec_mb} MB of Rewind recordings; they'd go into the backup." >&2
    echo "Download what you want, delete them (Settings > Rewind), and run this again." >&2
    echo "Or run with --include-recordings." >&2
    rmdir "$OUT"
    exit 1
  fi
  echo "==> Exporting PhotonVision's settings"
  python3 - "$JETSON_IP" "$OUT/photonvision-settings.zip" <<'PY'
import sys, urllib.request
ip, out = sys.argv[1], sys.argv[2]
data = urllib.request.urlopen(f"http://{ip}:5800/api/settings/photonvision_config.zip", timeout=60).read()
open(out, "wb").write(data)
print(f"    {len(data) / 1e6:.1f} MB")
PY
  "${SSH[@]}" 'echo "hostname: $(hostname)"; echo "L4T: $(head -1 /etc/nv_tegra_release)";
    echo "photonvision.jar: $(sha256sum /opt/photonvision/photonvision.jar | cut -c1-16)";
    echo "disk: $(df -h / | tail -1)"; echo "rewind recordings: $(du -sh /opt/photonvision/rewind/sessions 2>/dev/null | cut -f1)"' \
    > "$OUT/jetson-info.txt"
  echo "    repo: $(git -C "$REPO_ROOT" rev-parse --short HEAD)" >> "$OUT/jetson-info.txt"
  cat "$OUT/jetson-info.txt" | sed 's/^/    /'

  echo
  echo "Now put the Jetson in Force Recovery Mode:"
  echo "  power off, jumper FC REC to GND (button header J14, pins 9-10), power on, remove jumper."
fi
echo "Waiting for the Jetson in Force Recovery Mode (USB $RCM_USB_ID)..."
until lsusb -d "$RCM_USB_ID" >/dev/null; do sleep 2; done
echo "    found."

# 2. The backup.
sudo -v
NM_CONF=/etc/NetworkManager/conf.d/99-jetson-flash-unmanaged.conf
UFW_RULE=(from fc00:1:1::/48)
UFW_ADDED=0
UDISKS_STOPPED=0
cleanup() {
  echo "==> Restoring host settings"
  if [[ -f $NM_CONF ]]; then
    sudo rm -f "$NM_CONF"
    sudo systemctl reload NetworkManager || true
  fi
  if [[ $UFW_ADDED -eq 1 ]]; then sudo ufw delete allow "${UFW_RULE[@]}" >/dev/null || true; fi
  if [[ $UDISKS_STOPPED -eq 1 ]]; then sudo systemctl start udisks2 || true; fi
}
trap cleanup EXIT

if systemctl is-active --quiet NetworkManager; then
  sudo tee "$NM_CONF" >/dev/null <<'CONF'
[keyfile]
unmanaged-devices=driver:rndis_host;driver:cdc_ncm;driver:cdc_ether;interface-name:usb*
CONF
  sudo systemctl reload NetworkManager
fi
if systemctl is-active --quiet ufw; then
  sudo ufw allow "${UFW_RULE[@]}" >/dev/null
  UFW_ADDED=1
fi
if systemctl is-active --quiet udisks2; then
  sudo systemctl stop udisks2
  UDISKS_STOPPED=1
fi
systemctl is-active --quiet nfs-kernel-server || sudo systemctl start nfs-kernel-server

mkdir -p "$REPO_ROOT/logs"
LOG=$REPO_ROOT/logs/backup-$STAMP.log
echo "==> Backing up the Jetson's SSD (nvme0n1). Log: $LOG"
echo "    About 10-20 minutes. Do not unplug the Jetson."
cd "$L4T_DIR"
sudo ./tools/backup_restore/l4t_backup_restore.sh -e nvme0n1 -b "$BOARD" 2>&1 | tee "$LOG"

# 3. Keep the images with the settings export, owned by us, with checksums.
[[ -d $IMAGES ]] || { echo "Backup failed: no $IMAGES (see $LOG)." >&2; exit 1; }
sudo mv "$IMAGES" "$OUT/l4t-backup-images"
sudo chown -R "$(id -u):$(id -g)" "$OUT"
(cd "$OUT/l4t-backup-images" && sha256sum -- * > SHA256SUMS)
echo
echo "Backup done: $OUT ($(du -sh "$OUT" | cut -f1))"
ls -la "$OUT/l4t-backup-images" | sed 's/^/    /'
echo "The Jetson reboots normally on its own (or power-cycle it)."
echo "Restore with: scripts/host/05-restore-ssd.sh $OUT"
