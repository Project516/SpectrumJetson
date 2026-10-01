#!/usr/bin/env bash
# Adds two things to the flash image (Linux_for_Tegra/rootfs) so a freshly flashed Jetson can be
# set up over SSH without anyone at the keyboard:
#   1. passwordless sudo for the team account (/etc/sudoers.d/90-spectrum3847-nopasswd), the same
#      rule the team installed by hand on the first Jetson;
#   2. this laptop's saved Wi-Fi connection (default: the one named spectrum3847), so the Jetson
#      joins it at first boot and can download CUDA. The password is copied, never printed;
#   3. this laptop's SSH public key (KEY in config.env, .pub half), so the setup can log
#      in right after the flash with no ssh-copy-id. Only the public half is copied.
# Run it yourself, before 02-flash-nvme.sh. It uses sudo.
# Usage: prestage-rootfs.sh [wifi connection name]   (--undo removes all three from the image)
# The user, Wi-Fi connection and key come from config.env.
set -euo pipefail
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
source "$REPO_ROOT/config.env"
ROOTFS=$L4T_DIR/rootfs
WIFI=${1:-$WIFI_CONNECTION}
SUDOERS=$ROOTFS/etc/sudoers.d/90-$JETSON_USER-nopasswd
NM_DIR=$ROOTFS/etc/NetworkManager/system-connections
[[ -f $ROOTFS/etc/nv_tegra_release ]] || { echo "No flash image at $ROOTFS" >&2; exit 1; }

if [[ $WIFI == --undo ]]; then
  sudo rm -f "$SUDOERS" "$NM_DIR"/*.nmconnection "$ROOTFS/home/$JETSON_USER/.ssh/authorized_keys"
  echo "Removed the sudo rule, Wi-Fi connections and SSH key from the image."; exit 0
fi

echo "==> passwordless sudo for $JETSON_USER"
echo "$JETSON_USER ALL=(ALL) NOPASSWD: ALL" | sudo tee "$SUDOERS" >/dev/null
sudo chmod 440 "$SUDOERS"
sudo visudo -c -f "$SUDOERS"

echo "==> Wi-Fi connection '$WIFI'"
src=/etc/NetworkManager/system-connections/$WIFI.nmconnection
sudo test -f "$src" || { echo "No saved connection $src on this laptop" >&2; exit 1; }
sudo mkdir -p "$NM_DIR"
# Drop the laptop's interface name (the Jetson's is wlP1p1s0) and its MAC, keep everything else.
sudo sed -e '/^interface-name=/d' -e '/^mac-address=/d' "$src" | sudo tee "$NM_DIR/$WIFI.nmconnection" >/dev/null
sudo chmod 600 "$NM_DIR/$WIFI.nmconnection"
sudo chown root:root "$NM_DIR/$WIFI.nmconnection"
echo "==> SSH key"
KEY=$KEY.pub
if [[ -f $KEY ]]; then
  home=$(sudo awk -F: -v u="$JETSON_USER" '$1 == u {print $6}' "$ROOTFS/etc/passwd")
  [[ -n $home ]] || { echo "No $JETSON_USER user in the image: run 01-prepare-bsp.sh first" >&2; exit 1; }
  uid=$(sudo awk -F: -v u="$JETSON_USER" '$1 == u {print $3 ":" $4}' "$ROOTFS/etc/passwd")
  sudo install -d -m 700 -o "${uid%:*}" -g "${uid#*:}" "$ROOTFS$home/.ssh"
  sudo grep -qxF "$(cat "$KEY")" "$ROOTFS$home/.ssh/authorized_keys" 2>/dev/null || cat "$KEY" | sudo tee -a "$ROOTFS$home/.ssh/authorized_keys" >/dev/null
  sudo chown "$uid" "$ROOTFS$home/.ssh/authorized_keys"; sudo chmod 600 "$ROOTFS$home/.ssh/authorized_keys"
else
  echo "    no $KEY: skipped (use ssh-copy-id after the flash)"
fi
echo "Done. Now flash with scripts/host/02-flash-nvme.sh."
