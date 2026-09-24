#!/usr/bin/env bash
# Robot-readiness tuning for the Jetson. Run ON THE JETSON; asks for sudo once.
# Safe to re-run. Reboot afterwards to get the boot-time and persistence benefits.
#
#   1. No automatic updates   - apt must not update NVIDIA/Java packages mid-event
#   2. snapd off              - its first-boot "seeding" took 45 s of every boot (no snaps used)
#   3. Headless               - boot to multi-user (no GNOME desktop on a robot)
#   4. Clocks locked at boot  - jetson_clocks after nvpmodel, before PhotonVision
#                               (MAXN SUPER persists; jetson_clocks does not)
#   5. No USB autosuspend     - for every UVC camera, so cameras never suspend/reconnect
#
# Usage: 09-robot-tuning.sh [--undo]
set -euo pipefail

APT_CONF=/etc/apt/apt.conf.d/99spectrum-no-auto-updates
CLOCKS_UNIT=/etc/systemd/system/jetson-clocks.service
UDEV_RULE=/etc/udev/rules.d/90-spectrum-camera-power.rules
SNAP_UNITS=(snapd.service snapd.socket snapd.seeded.service)

sudo -v

if [[ ${1:-} == --undo ]]; then
  sudo rm -f "$APT_CONF" "$UDEV_RULE"
  sudo systemctl enable apt-daily.timer apt-daily-upgrade.timer
  sudo systemctl unmask "${SNAP_UNITS[@]}"
  sudo systemctl enable snapd.service snapd.socket snapd.seeded.service
  sudo systemctl disable jetson-clocks.service 2>/dev/null || true
  sudo rm -f "$CLOCKS_UNIT"
  sudo systemctl set-default graphical.target
  sudo systemctl daemon-reload
  sudo udevadm control --reload
  echo "Undone. Reboot to take effect."
  exit 0
fi

echo "==> 1. Automatic updates off"
sudo systemctl disable --now apt-daily.timer apt-daily-upgrade.timer
sudo tee "$APT_CONF" >/dev/null <<'EOF'
// SpectrumJetson: robot coprocessor, no background package updates.
APT::Periodic::Update-Package-Lists "0";
APT::Periodic::Download-Upgradeable-Packages "0";
APT::Periodic::Unattended-Upgrade "0";
APT::Periodic::AutocleanInterval "0";
EOF

echo "==> 2. snapd off"
if snap list 2>/dev/null | grep -qv "^Name"; then
  echo "    snaps are installed; leaving snapd alone"
else
  sudo systemctl disable --now "${SNAP_UNITS[@]}" 2>/dev/null || true
  sudo systemctl mask "${SNAP_UNITS[@]}"
fi

echo "==> 3. Headless (multi-user.target)"
sudo systemctl set-default multi-user.target

echo "==> 4. jetson_clocks at boot"
sudo tee "$CLOCKS_UNIT" >/dev/null <<'EOF'
[Unit]
Description=Lock Jetson CPU/GPU/EMC clocks at max for consistent vision latency (SpectrumJetson)
After=nvpmodel.service
Before=photonvision.service

[Service]
Type=oneshot
ExecStart=/usr/bin/jetson_clocks
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now jetson-clocks.service

echo "==> 5. No USB autosuspend for cameras"
# Any device with a uvcvideo interface: set power/control=on on the USB device (the parent).
sudo tee "$UDEV_RULE" >/dev/null <<'EOF'
# SpectrumJetson: keep UVC cameras powered (no autosuspend -> no dropouts/reconnects).
ACTION=="add|bind", SUBSYSTEM=="usb", DRIVER=="uvcvideo", TEST=="../power/control", ATTR{../power/control}="on"
EOF
sudo udevadm control --reload
# Apply to cameras already plugged in.
for intf in /sys/bus/usb/drivers/uvcvideo/*:*; do
  [[ -e $intf ]] || continue
  dev=$(dirname "$(readlink -f "$intf")")
  echo on | sudo tee "$dev/power/control" >/dev/null
done

echo
echo "Summary:"
# (|| true: systemctl is-enabled exits non-zero for disabled/masked units, which is the goal.)
echo "  apt timers: $(systemctl is-enabled apt-daily.timer apt-daily-upgrade.timer 2>&1 | paste -sd' ' || true)"
echo "  snapd: $(systemctl is-enabled snapd.service 2>&1 || true)"
echo "  default target: $(systemctl get-default)"
echo "  jetson-clocks: $(systemctl is-enabled jetson-clocks.service 2>&1 || true), $(systemctl is-active jetson-clocks.service 2>&1 || true)"
for intf in /sys/bus/usb/drivers/uvcvideo/*:1.0; do
  [[ -e $intf ]] || continue
  dev=$(dirname "$(readlink -f "$intf")")
  echo "  camera $(basename "$dev"): power/control=$(cat "$dev/power/control")"
done
echo "Reboot to apply the boot changes: sudo reboot"
