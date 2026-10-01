#!/usr/bin/env bash
# SpectrumJetson (10-data-partition.sh): runs at every boot after the filesystems mount and before
# PhotonVision starts. If a data partition didn't mount (a power cut damaged it past what fsck
# could repair), it puts something safe in its place so PhotonVision still runs the match:
#
#   scratch missing:  PhotonVision's logs and the system log go to RAM, and Rewind gets a tiny RAM
#                     folder, so it finds no free space and doesn't record.
#   settings missing: PhotonVision runs on the last-good settings committed to the system partition
#                     (10-data-partition.sh --commit-settings; ro-root on does it), through a RAM
#                     overlay: the real pipelines and calibrations, but changes aren't kept. With
#                     no committed copy, it gets empty RAM folders and starts on defaults.
#
# Nothing is written to either partition. The result is in /run/spectrum-data-status, which
# health-check.sh and Match Ready read.
set -uo pipefail
SET=/data/settings
SCR=/data/scratch
PV=/opt/photonvision
LAST_GOOD=$PV/.last-good-settings
RUN=/run/spectrum-data
STATUS=/run/spectrum-data-status
mkdir -p "$RUN"
settings=ok scratch=ok

ram() {  # ram DIR SIZE: an empty RAM folder over DIR
  mkdir -p "$1"; mountpoint -q "$1" || mount -t tmpfs -o "size=$2,mode=0755" spectrum-ram "$1"
}

if ! mountpoint -q "$SET"; then
  if [[ -d $LAST_GOOD/photonvision_config ]]; then
    settings=last-good
    for d in photonvision_config snapshots fieldcal; do
      mountpoint -q "$PV/$d" && continue
      mkdir -p "$PV/$d" "$LAST_GOOD/$d"
      ram "$RUN/ovl-$d" 256M
      mkdir -p "$RUN/ovl-$d/upper" "$RUN/ovl-$d/work"
      mount -t overlay spectrum-last-good \
        -o "lowerdir=$LAST_GOOD/$d,upperdir=$RUN/ovl-$d/upper,workdir=$RUN/ovl-$d/work" "$PV/$d"
    done
    state_src=$LAST_GOOD/spectrum-robot-state.json
  else
    settings=defaults
    ram "$PV/photonvision_config" 256M
    ram "$PV/snapshots" 16M
    ram "$PV/fieldcal" 16M
    state_src=""
  fi
  f=$PV/spectrum-robot-state.json
  if ! mountpoint -q "$f"; then
    if [[ -n $state_src && -f $state_src ]]; then cp "$state_src" "$RUN/robot-state.json"
    else echo '{}' > "$RUN/robot-state.json"; fi
    [[ -e $f ]] || touch "$f" 2>/dev/null
    mount --bind "$RUN/robot-state.json" "$f"
  fi
fi

if ! mountpoint -q "$SCR"; then
  scratch=missing
  ram "$PV/photonvision_config/logs" 64M
  ram "$PV/rewind" 1M
  # Without this the system log would write to the empty /var/log/journal on the system partition.
  # This runs before systemd-journal-flush moves the log out of /run, so it lands in RAM.
  ram /var/log/journal 64M
fi

echo "settings=$settings scratch=$scratch" > "$STATUS"
echo "settings=$settings scratch=$scratch"
