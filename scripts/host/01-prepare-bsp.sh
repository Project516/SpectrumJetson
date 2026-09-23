#!/usr/bin/env bash
# Extract the Jetson Linux BSP + sample rootfs, install host flash prerequisites,
# apply NVIDIA binaries, and bake in a default user so first boot skips oem-config.
#
# Run as your normal user (not with sudo); it calls sudo where needed.
# Usage: scripts/host/01-prepare-bsp.sh [--force]
#   --force  re-extract even if Linux_for_Tegra already exists
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
source "$REPO_ROOT/config.env"

FORCE=0
[[ ${1:-} == --force ]] && FORCE=1

if [[ $EUID -eq 0 ]]; then
  echo "Run this as your normal user, not root. It will sudo when needed." >&2
  exit 1
fi

cd "$L4T_WORKDIR"
for f in "$L4T_BSP_TARBALL" "$L4T_ROOTFS_TARBALL"; do
  if [[ ! -s $f ]]; then
    echo "Missing $L4T_WORKDIR/$f. Download it from:" >&2
    echo "  $L4T_URL_BASE/$f" >&2
    exit 1
  fi
done

sudo -v

if [[ -d $L4T_DIR && $FORCE -eq 1 ]]; then
  echo "==> Removing old $L4T_DIR"
  sudo rm -rf "$L4T_DIR"
fi

# Marker files are written only after each extraction completes, so an
# interrupted run re-extracts instead of flashing a partial rootfs.
if [[ -f $L4T_DIR/.bsp-extracted ]]; then
  echo "==> BSP already extracted"
else
  echo "==> Extracting BSP"
  tar xf "$L4T_BSP_TARBALL"
  touch "$L4T_DIR/.bsp-extracted"
fi

if [[ -f $L4T_DIR/.rootfs-extracted ]]; then
  echo "==> Sample rootfs already extracted"
else
  echo "==> Extracting sample rootfs (as root, preserving permissions)"
  sudo tar xpf "$L4T_ROOTFS_TARBALL" -C "$L4T_DIR/rootfs/"
  touch "$L4T_DIR/.rootfs-extracted"
fi

cd "$L4T_DIR"

echo "==> Installing host flash prerequisites"
sudo ./tools/l4t_flash_prerequisites.sh

echo "==> Applying NVIDIA binaries to rootfs"
sudo ./apply_binaries.sh

echo "==> Creating default user"
user=$JETSON_USER
host=$JETSON_HOSTNAME
[[ -n $user ]] || read -rp "Jetson username: " user
[[ -n $host ]] || read -rp "Jetson hostname: " host
while true; do
  read -rsp "Password for $user: " pw; echo
  read -rsp "Confirm password: " pw2; echo
  [[ -n $pw && $pw == "$pw2" ]] && break
  echo "Passwords empty or did not match, try again."
done
# NVIDIA's script echoes the password in plain text; mask it.
sudo ./tools/l4t_create_default_user.sh -u "$user" -p "$pw" -n "$host" --accept-license \
  | sed -E 's/(Password - )[^,]*/\1********/'
unset pw pw2

echo
echo "BSP ready at $L4T_DIR"
echo "Next: put the Jetson in Force Recovery Mode, then run scripts/host/02-flash-nvme.sh"
