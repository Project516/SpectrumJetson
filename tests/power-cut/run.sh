#!/usr/bin/env bash
# Power-cut test: what survives pulling the Jetson's power mid-recording? Run ON THE LAPTOP, with
# the Jetson on the USB-C cable. It starts a bench recording, you pull the power plug when told,
# and after the Jetson boots again it checks:
#   - ext4 recorded no errors, and the kernel replayed its journal cleanly,
#   - the log from before the cut survived (persistent journal),
#   - PhotonVision came back healthy,
#   - how much of the recording survived: seconds lost vs the last status the laptop saw, and every
#     saved frame is a complete JPEG.
# Usage: tests/power-cut/run.sh [seconds_before_cut]   (default 20)
set -uo pipefail
JETSON=${JETSON:-192.168.55.1}
KEY=${KEY:-$HOME/.ssh/jetson_ed25519}
WAIT=${1:-20}
HERE=$(cd "$(dirname "$0")" && pwd)
SSH=(ssh -i "$KEY" -o ConnectTimeout=3 -o BatchMode=yes "spectrum3847@$JETSON")
API=http://$JETSON:5800/api/rewind

api() { # GET (no body) or POST a JSON body; prints the reply, or nothing on failure
  python3 - "$API" "${1:-}" <<'PY' 2>/dev/null
import sys, urllib.request
url, body = sys.argv[1], sys.argv[2]
req = urllib.request.Request(url, data=body.encode() if body else None,
                             headers={"Content-Type": "application/json"})
print(urllib.request.urlopen(req, timeout=1).read().decode())
PY
}
field() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('$1',''))" 2>/dev/null; }

boot_before=$("${SSH[@]}" 'cat /proc/sys/kernel/random/boot_id') || { echo "Jetson not reachable at $JETSON"; exit 1; }
api '{"manual": true}' >/dev/null || { echo "Rewind API not reachable"; exit 1; }
sleep 1
session=$(api | field session)
[[ -n $session ]] || { echo "Recording did not start"; exit 1; }
echo "Recording $session. Pull the Jetson's power plug after the countdown."

last_secs=0 dark_since=0 t_start=$(date +%s)
while :; do
  now=$(date +%s)
  s=$(api)
  if [[ -n $s ]]; then
    last_secs=$(field seconds <<<"$s")
    dark_since=0
    left=$((WAIT - (now - t_start)))
    if ((left > 0)); then printf "\r  recording %5.1f s ... pull the power in %2d s " "$last_secs" "$left"
    else printf "\r  recording %5.1f s ... PULL THE POWER NOW          " "$last_secs"; fi
  else
    ((dark_since == 0)) && dark_since=$now
    if ((now - dark_since >= 3)); then break; fi
  fi
  sleep 0.2
done
printf "\n  Jetson went dark; last status said %.1f s recorded.\n" "$last_secs"
echo "Plug the power back in. Waiting for the Jetson to boot..."
until "${SSH[@]}" true 2>/dev/null; do sleep 2; done
boot_after=$("${SSH[@]}" 'cat /proc/sys/kernel/random/boot_id')
[[ $boot_after != "$boot_before" ]] || { echo "The Jetson did not reboot (same boot id); was the power pulled?"; exit 1; }
echo "Booted. Waiting for PhotonVision..."
until [[ -n $(api) ]]; do sleep 2; done
sleep 10 # let the detectors start

echo
echo "== Filesystem"
"${SSH[@]}" 'bash -s' <<'REMOTE'
dev=$(basename "$(findmnt -no SOURCE /)")
echo "  ext4 errors recorded: $(cat /sys/fs/ext4/$dev/errors_count)"
journalctl -k -b 0 --no-pager -o cat | grep -F "EXT4-fs ($dev)" | sed 's/^/  kernel: /'
REMOTE
echo "== Log from before the cut (the last lines the old boot saved)"
# By boot id: -b -1 is unreliable here, since the clock restarts at 1970 after a cut (no RTC battery).
"${SSH[@]}" "journalctl _BOOT_ID=${boot_before//-/} --no-pager -o short-iso -n 3 2>&1 | sed 's/^/  /'"
echo "== PhotonVision"
"${SSH[@]}" '~/SpectrumJetson/scripts/jetson/health-check.sh' | sed -n '/== PhotonVision/,/== Cameras/p' | grep -v '== Cameras'
echo "== The recording"
"${SSH[@]}" "cat /opt/photonvision/rewind/sessions/$session/session.json" | python3 -c '
import json, sys
m = json.load(sys.stdin)
print("  session.json:", "ended cleanly (" + m["endReason"] + ")" if m.get("endReason") else "no end recorded (expected: power was cut)")'
dest=$(mktemp -d)
rsync -a -e "ssh -i $KEY" "spectrum3847@$JETSON:/opt/photonvision/rewind/sessions/$session" "$dest/"
python3 "$HERE/../../scripts/host/rewind-export.py" "$dest/$session" --out "$dest/export" | sed 's/^/  /'
python3 - "$dest/$session" "$last_secs" <<'PY'
import csv, glob, os, sys
sess, last = sys.argv[1], float(sys.argv[2])
for cam in sorted(glob.glob(sess + "/*/")):
    t = []
    for idx in sorted(glob.glob(cam + "*.csv")):
        data = idx[:-4] + ".mjpeg"
        n = os.path.getsize(data) if os.path.exists(data) else 0
        for r in csv.reader(l for l in open(idx) if not l.startswith("#")):
            if len(r) >= 7 and int(r[1]) + int(r[2]) <= n:
                t.append(int(r[5]))
    if not t:
        print(f"  {os.path.basename(cam[:-1])}: nothing saved")
        continue
    dur = (t[-1] - t[0]) / 1e6
    print(f"  {os.path.basename(cam[:-1])}: {dur:.1f} s saved, {last:.1f} s seen recording -> "
          f"about {max(0.0, last - dur):.1f} s lost at the cut")
PY
echo
echo "Copied to $dest (delete it when done). The recording stays on the Jetson; delete it in the UI."
