#!/usr/bin/env bash
# Event thermal test: what a real event does to a cold Jetson. At an event the robot is off except
# in queue, on the field and for short pit checks, so the fair test starts cold:
#
#   tests/thermal/event-sim.sh --arm      arm it (run ON THE JETSON), then cut the power
#   (leave it off ~30 min to cool to room temperature, then power it on and leave it ~10 min)
#   tests/thermal/event-sim.sh --report   afterwards: the log, the peak, and how much the match added
#
# At the next boot it runs once (then disarms itself): a fake robot plays queue and field setup
# (disabled QUEUE_S, default 300 s at idle 30 fps), auto 15 s, 3 s gap, teleop 135 s, then 120 s
# disabled after the match, while tests/thermal/run.sh logs every 10 s from boot.
# Arming persists across the power cut only with the system partition writable (ro-root off).
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
UNIT=/etc/systemd/system/spectrum-event-sim.service
QUEUE_S=${QUEUE_S:-300}

case ${1:-} in
  --arm)
    [[ $(findmnt -n -o FSTYPE /) == overlay ]] && { echo "The system partition is read-only (ro-root on): arming wouldn't survive the power cut. ro-root.sh off first." >&2; exit 1; }
    sudo tee "$UNIT" >/dev/null <<UNIT
[Unit]
Description=SpectrumJetson event thermal test (runs once, tests/thermal/event-sim.sh)
After=photonvision.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$USER
Environment=QUEUE_S=$QUEUE_S
ExecStartPre=+/bin/systemctl disable spectrum-event-sim.service
ExecStart=$HERE/event-sim.sh --run
TimeoutStartSec=1800

[Install]
WantedBy=multi-user.target
UNIT
    sudo systemctl daemon-reload && sudo systemctl enable spectrum-event-sim.service
    echo "Armed. Cut the power, leave it ~30 min to cool, power it on, leave it ~10 min. Then: $0 --report"
    ;;
  --run)
    # Logged from boot; the fake robot waits for PhotonVision to connect.
    STOP_C=97 "$HERE/run.sh" $(( (QUEUE_S + 15 + 3 + 135 + 120) / 60 + 3 )) event-sim > "$HOME/thermal-event-sim.out" 2>&1 &
    log=$!
    "$ROOT/tests/fake-robot/run.sh" "disabled:$QUEUE_S" fms-auto:15 fms-disabled:3 fms-enabled:135 fms-disabled:120 \
      > "$HOME/fake-robot-event-sim.out" 2>&1
    cp /tmp/fake-robot.log "$HOME/fake-robot-event-sim.phases" 2>/dev/null
    wait $log
    ;;
  --report)
    csv=$(ls -t "$HOME"/thermal-event-sim-*.csv 2>/dev/null | head -1)
    [[ -n $csv ]] || { echo "No event-sim log yet (armed: $(systemctl is-enabled spectrum-event-sim 2>/dev/null))"; exit 1; }
    cat "$HOME/thermal-event-sim.out"
    python3 - "$csv" "$HOME/fake-robot-event-sim.phases" <<'PY'
import csv, sys, re
rows = [r for r in csv.DictReader(open(sys.argv[1])) if r["tj_c"]]
phases = []
try:
    for line in open(sys.argv[2]):
        m = re.match(r"phase (\d+) (\S+) (\d+)", line)
        if m: phases.append((m.group(2), int(m.group(3)) / 1000))
except FileNotFoundError:
    pass
print(f"{len(rows)} samples; first {rows[0]['tj_c']} C, peak {max(float(r['tj_c']) for r in rows):.1f} C")
if phases:
    print("phases:", ", ".join(p for p, _ in phases))
print("time_min  tj_C  power_W  cameras")
for r in rows[::3]:
    print(f"{int(r['time_s'])/60:8.1f}  {float(r['tj_c']):5.1f}  {float(r['power_w']):6.2f}  {r['cameras_fps']}")
PY
    ;;
  *) sed -n '2,13p' "$0"; exit 2 ;;
esac
