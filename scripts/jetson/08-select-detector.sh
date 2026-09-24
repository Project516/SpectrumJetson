#!/usr/bin/env bash
# Choose which lib971apriltag.so PhotonVision loads, and its runtime options.
# Run ON THE JETSON. Both builds have the same Java API.
#
# Usage: 08-select-detector.sh 4143|bos [--mwbd N] [--no-restart]
#   4143   FRC-Team-4143/GpuDetectorJNI + our patches (05-build-gpudetector.sh)
#   bos    Austin's current detector via frc971/bos (07-build-bos-detector.sh)
#   --mwbd N         min_white_black_diff (bos build only; default 5)
# (Fault injection for testing: echo N > /tmp/spectrum-971-fault-every; rm it to stop.)
set -euo pipefail

which=${1:?usage: $0 4143|bos [--mwbd N] [--no-restart]}
shift
mwbd=""
restart=1
while [[ $# -gt 0 ]]; do
  case $1 in
    --mwbd) mwbd=$2; shift 2 ;;
    --no-restart) restart=0; shift ;;
    *) echo "unknown option $1" >&2; exit 1 ;;
  esac
done

case $which in
  4143) lib=$HOME/build/GpuDetectorJNI/build/lib971apriltag.so ;;
  bos) lib=$HOME/build/bos-detector/lib971apriltag.so ;;
  *) echo "first argument must be 4143 or bos" >&2; exit 1 ;;
esac
[[ -f $lib ]] || { echo "Missing $lib; build it first." >&2; exit 1; }

sudo install -m 755 "$lib" /usr/lib/lib971apriltag.so

dropin=/etc/systemd/system/photonvision.service.d/971.conf
env_lines=""
[[ -n $mwbd ]] && env_lines+="Environment=SPECTRUM_971_MIN_WHITE_BLACK_DIFF=$mwbd"$'\n'
if [[ -n $env_lines ]]; then
  printf '[Service]\n%s' "$env_lines" | sudo tee "$dropin" >/dev/null
else
  sudo rm -f "$dropin"
fi
sudo systemctl daemon-reload

echo "Selected $which detector${mwbd:+, min_white_black_diff $mwbd}"
if [[ $restart -eq 1 ]]; then
  sudo systemctl restart photonvision
fi
