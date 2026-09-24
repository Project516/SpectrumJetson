#!/usr/bin/env bash
# Restore a backup made by 04-backup-ssd.sh onto the Jetson's SSD: the same SSD (undo a broken
# setup) or a blank spare SSD (a replacement, ready to swap in at an event). Everything on the
# SSD is replaced: the system, PhotonVision and its settings, calibrations, and recordings.
#
# The Jetson must be in Force Recovery Mode, connected over the USB-C cable. About 10-20 minutes.
# Temporarily changes the same host settings as 04-backup-ssd.sh (reverted on exit).
#
# Run as your normal user; it uses sudo where needed.
# Usage: 05-restore-ssd.sh <backup folder, e.g. ~/jetson-backups/20261001-190000>
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
source "$REPO_ROOT/config.env"
BACKUP=${1:?usage: $0 <backup folder>}
BACKUP=$(cd "$BACKUP" && pwd)
IMAGES=$L4T_DIR/tools/backup_restore/images

if [[ $EUID -eq 0 ]]; then
  echo "Run this as your normal user, not root. It will sudo when needed." >&2
  exit 1
fi
[[ -d $BACKUP/l4t-backup-images ]] || { echo "$BACKUP has no l4t-backup-images/." >&2; exit 1; }
if [[ -e $IMAGES ]]; then
  echo "$IMAGES already exists (a previous backup or restore that didn't finish?)." >&2
  echo "Move it out of the way first." >&2
  exit 1
fi

echo "==> Checking the backup's checksums"
(cd "$BACKUP/l4t-backup-images" && sha256sum --quiet -c SHA256SUMS) \
  || { echo "The backup is damaged (checksum mismatch). Not restoring it." >&2; exit 1; }
[[ -f $BACKUP/jetson-info.txt ]] && sed 's/^/    /' "$BACKUP/jetson-info.txt"

echo
echo "This ERASES the Jetson's SSD and replaces it with the backup from $(basename "$BACKUP")."
read -r -p "Type 'restore' to continue: " answer
[[ $answer == restore ]] || { echo "Cancelled."; exit 1; }

if ! lsusb -d "$RCM_USB_ID" >/dev/null; then
  echo "Put the Jetson in Force Recovery Mode:"
  echo "  power off, jumper FC REC to GND (button header J14, pins 9-10), power on, remove jumper."
fi
echo "Waiting for the Jetson in Force Recovery Mode (USB $RCM_USB_ID)..."
until lsusb -d "$RCM_USB_ID" >/dev/null; do sleep 2; done
echo "    found."

sudo -v
NM_CONF=/etc/NetworkManager/conf.d/99-jetson-flash-unmanaged.conf
UFW_RULE=(from fc00:1:1::/48)
UFW_ADDED=0
UDISKS_STOPPED=0
MOVED=0
cleanup() {
  echo "==> Restoring host settings"
  # Put the backup back where it came from.
  if [[ $MOVED -eq 1 && -d $IMAGES ]]; then mv "$IMAGES" "$BACKUP/l4t-backup-images"; fi
  if [[ -f $NM_CONF ]]; then
    sudo rm -f "$NM_CONF"
    sudo systemctl reload NetworkManager || true
  fi
  if [[ $UFW_ADDED -eq 1 ]]; then sudo ufw delete allow "${UFW_RULE[@]}" >/dev/null || true; fi
  if [[ $UDISKS_STOPPED -eq 1 ]]; then sudo systemctl start udisks2 || true; fi
}
trap cleanup EXIT

# The Jetson reads the images over NFS from $IMAGES (a symlink out of the shared folder wouldn't
# resolve on the Jetson), so move the backup there for the restore; cleanup moves it back.
mv "$BACKUP/l4t-backup-images" "$IMAGES"
MOVED=1
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
LOG=$REPO_ROOT/logs/restore-$(date +%Y%m%d-%H%M%S).log
echo "==> Restoring $(basename "$BACKUP") to the Jetson's SSD. Log: $LOG"
cd "$L4T_DIR"
sudo ./tools/backup_restore/l4t_backup_restore.sh -e nvme0n1 -r "$BOARD" 2>&1 | tee "$LOG"
echo
echo "Restore finished. The Jetson boots the restored system; check it with"
echo "  ssh $JETSON_USER@192.168.55.1 ~/SpectrumJetson/scripts/jetson/health-check.sh"
