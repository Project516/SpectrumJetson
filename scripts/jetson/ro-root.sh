#!/usr/bin/env bash
# Read-only system partition, with NVIDIA's own overlay (nv_overlayfs_config, from nvidia-l4t-tools):
# at boot NVIDIA's initrd mounts the system partition read-only underneath and a RAM layer on top,
# so nothing that runs can write to it, and everything written there is gone at the next boot.
# The settings and scratch partitions (10-data-partition.sh) aren't part of it: tuning, Rewind and
# logs work as before.
#
#   ro-root.sh on      commit the current settings as the last-good copy, enable, reboot
#   ro-root.sh off     disable and reboot (to update or install anything: it's lost otherwise)
#   ro-root.sh status
#
# Updating: ro-root.sh off; (reboots) update; ro-root.sh on. Add --no-reboot to on/off to reboot
# yourself later. Run ON THE JETSON.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
sudo -n true 2>/dev/null || sudo -v

active() { [[ $(findmnt -n -o FSTYPE /) == overlay ]]; }
configured() { sudo nv_overlayfs_config --status 2>/dev/null | grep -qi "enabled"; }

case ${1:-status} in
  status)
    if active; then echo "system partition: READ-ONLY (overlay active; changes to it vanish at reboot)"
    else echo "system partition: writable"; fi
    if configured; then echo "next boot: read-only"; else echo "next boot: writable"; fi
    used=$(df --output=used -k / | tail -1)
    if active; then echo "RAM layer in use: $((used / 1024)) MB written since boot"; fi
    ;;
  on)
    if active; then echo "Already read-only."; exit 0; fi
    findmnt -n /data/settings >/dev/null || { echo "STOP: /data/settings isn't mounted: run 10-data-partition.sh first" >&2; exit 1; }
    echo "==> Committing the current settings as the last-good copy (for a damaged settings partition)"
    "$HERE/10-data-partition.sh" --commit-settings
    sync
    echo "==> Enabling the read-only system"
    sudo nv_overlayfs_config --enable
    if [[ ${2:-} != --no-reboot ]]; then echo "Rebooting..."; sudo systemctl reboot; fi
    ;;
  off)
    sudo nv_overlayfs_config --disable
    if [[ ${2:-} != --no-reboot ]]; then echo "Rebooting to a writable system..."; sudo systemctl reboot; fi
    ;;
  *) sed -n '2,13p' "$0"; exit 2 ;;
esac
