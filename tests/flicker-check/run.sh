#!/usr/bin/env bash
# Light-flicker check for the current exposure: records 10 s with Rewind (bench switch), then
# reports each camera's frame-to-frame brightness change. Run ON THE JETSON (no sudo), cameras
# pointed at the scene (ideally the event field, under its lights).
# Under 120 Hz flickering lights, exposures that aren't a multiple of 8.33 ms catch a different part
# of each flicker cycle, so frames pulse in brightness. Bench, exposure 50 (5 ms), shop LEDs:
# 0.6% average change, 1% max: no flicker. Several % frame to frame means flicker: use 83 (8.3 ms).
set -euo pipefail
api() {
  python3 -c "import urllib.request as u, sys; u.urlopen(u.Request('http://localhost:5800/api/rewind', data=sys.argv[1].encode(), headers={'Content-Type': 'application/json'}), timeout=10)" "$1"
}
echo "Recording 10 s..."
api '{"manual": true}'
sleep 10
api '{"manual": false}'
sleep 2
python3 "$(dirname "$0")/flicker.py"
echo "(The recording stays on the Jetson; delete it in Settings > Rewind.)"
