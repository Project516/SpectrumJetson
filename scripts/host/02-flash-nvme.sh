#!/usr/bin/env bash
# Flash QSPI bootloader + NVMe rootfs on an Orin Nano Super devkit in Force Recovery Mode.
#
# While flashing, this temporarily:
#   - tells NetworkManager to leave the Jetson's USB network interface alone
#     (otherwise it DHCPs the interface and drops the address mid-flash)
#   - allows the flash tool's IPv6 subnet (fc00:1:1::/48) through ufw
# Both are reverted on exit, success or failure.
#
# Run as your normal user (not with sudo); it calls sudo where needed.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
source "$REPO_ROOT/config.env"

if [[ $EUID -eq 0 ]]; then
  echo "Run this as your normal user, not root. It will sudo when needed." >&2
  exit 1
fi

if [[ ! -x $L4T_DIR/tools/kernel_flash/l4t_initrd_flash.sh ]]; then
  echo "No BSP at $L4T_DIR. Run scripts/host/01-prepare-bsp.sh first." >&2
  exit 1
fi

if ! lsusb -d "$RCM_USB_ID" >/dev/null; then
  echo "No Jetson in Force Recovery Mode (USB $RCM_USB_ID) found." >&2
  echo "Power off, jumper FC REC to GND (button header J14, pins 9-10), power on, remove jumper." >&2
  exit 1
fi

sudo -v

NM_CONF=/etc/NetworkManager/conf.d/99-jetson-flash-unmanaged.conf
UFW_RULE=(from fc00:1:1::/48)
UFW_ADDED=0

cleanup() {
  echo "==> Restoring host network settings"
  if [[ -f $NM_CONF ]]; then
    sudo rm -f "$NM_CONF"
    sudo systemctl reload NetworkManager || true
  fi
  if [[ $UFW_ADDED -eq 1 ]]; then
    sudo ufw delete allow "${UFW_RULE[@]}" >/dev/null || true
  fi
}
trap cleanup EXIT

if systemctl is-active --quiet NetworkManager; then
  echo "==> Telling NetworkManager to ignore USB gadget network interfaces"
  # The Jetson shows up as a USB network gadget; host USB NICs (e.g. r8152) are unaffected.
  sudo tee "$NM_CONF" >/dev/null <<'EOF'
[keyfile]
unmanaged-devices=driver:rndis_host;driver:cdc_ncm;driver:cdc_ether;interface-name:usb*
EOF
  sudo systemctl reload NetworkManager
fi

if systemctl is-active --quiet ufw; then
  echo "==> Temporarily allowing flash subnet through ufw"
  sudo ufw allow "${UFW_RULE[@]}" >/dev/null
  UFW_ADDED=1
fi

mkdir -p "$REPO_ROOT/logs"
LOG=$REPO_ROOT/logs/flash-$(date +%Y%m%d-%H%M%S).log
echo "==> Flashing $BOARD (L4T $L4T_VERSION) to NVMe. Log: $LOG"
echo "    This takes roughly 10-20 minutes. Do not unplug the Jetson."

cd "$L4T_DIR"
sudo ./tools/kernel_flash/l4t_initrd_flash.sh \
  --external-device nvme0n1p1 \
  -c tools/kernel_flash/flash_l4t_t234_nvme.xml \
  -p "-c bootloader/generic/cfg/flash_t234_qspi.xml" \
  --showlogs --network usb0 --erase-all \
  "$BOARD" internal 2>&1 | tee "$LOG"

echo
echo "Flash finished. The Jetson reboots into the new image from NVMe."
echo "Next: log in (monitor/keyboard, or 'ssh <user>@192.168.55.1' over the USB-C cable)"
echo "and run scripts/jetson/01-verify.sh on the Jetson."
