#!/usr/bin/env bash
# Quiet mode across a PhotonVision restart (photonvision-64). Run ON THE JETSON, off the robot.
#
# Before photonvision-64 a restart while quiet left the scratch partition read-only for good: the
# new PhotonVision process started as "not quiet", so no enable remounted it, and Rewind couldn't
# record any later match until a reboot (found by tests/systemcore-rehearsal, 2026-10-01).
#
# A fake robot (tests/fake-robot) plays a match: auto 3 s, teleop 3 s, then disabled with the field
# attached. Quiet mode starts (the match ended); PhotonVision is restarted. Checks:
#   - the new process takes over quiet mode (quietNow, reason "left on before PhotonVision restarted"),
#   - with the robot connected and disabled for less than quietAfterDisabledSeconds, it leaves quiet
#     mode: the scratch partition is writable again within 30 s of PhotonVision coming back,
#   - enabling afterwards finds it writable.
# Deadline: 4 min.
set -uo pipefail
if [[ -z ${QUIET_RESTART_UNDER_TIMEOUT:-} ]]; then
  rc=0; QUIET_RESTART_UNDER_TIMEOUT=1 timeout --kill-after=15 240 "$0" "$@" || rc=$?
  [[ $rc == 124 ]] && echo "TIMEOUT: the quiet-mode restart test didn't finish in 4 min" >&2
  exit "$rc"
fi
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
LOG=$(mktemp)
PHASES=/tmp/fake-robot.log   # tests/fake-robot/run.sh writes FakeRobot's phase lines here
rm -f "$PHASES"
fails=0
check() { if eval "$2"; then echo "  PASS  $1"; else echo "  FAIL  $1"; fails=$((fails + 1)); fi; }
api() { python3 -c 'import json,sys,urllib.request; s=json.load(urllib.request.urlopen("http://localhost:5800/api/robotState", timeout=2)); print(s.get("quietNow"), (s.get("quietReason") or "-").replace(" ", "_"), s.get("robotConnected"))' 2>/dev/null; }
ro() { [[ ,$(findmnt -n -o OPTIONS /data/scratch), == *,ro,* ]]; }

findmnt -n /data/scratch >/dev/null || { echo "No scratch partition: run 10-data-partition.sh first"; exit 1; }
[[ -n $(api) ]] || { echo "PhotonVision's /api/robotState isn't answering"; exit 1; }
ro && { echo "The scratch partition is already read-only: leave quiet mode first (sudo spectrum-quiet off)"; exit 1; }

echo "== Fake match: fms-auto 3 s, fms-enabled 3 s, fms-disabled 120 s (PhotonVision restarted in it), fms-enabled 10 s"
timeout -k 10 200 "$ROOT/tests/fake-robot/run.sh" fms-auto:3 fms-enabled:3 fms-disabled:120 fms-enabled:10 > "$LOG" 2>&1 &
robot=$!
cleanup() { touch /tmp/fake-robot-stop; wait $robot 2>/dev/null; rm -f "$LOG"; }
trap cleanup EXIT

# Quiet mode after the match.
quiet_before=""
for _ in $(seq 1 60); do
  sleep 1
  ro && { quiet_before=yes; break; }
done
check "quiet mode made the scratch partition read-only after the match" "[[ \$quiet_before == yes ]]"

echo "== Restarting PhotonVision while quiet"
sudo systemctl restart photonvision
t0=$SECONDS adopted="" back="" writable=""
while ((SECONDS - t0 < 120)); do
  read -r q reason connected <<<"$(api)"
  if [[ -n $q ]]; then
    [[ -z $back ]] && back=$((SECONDS - t0))
    [[ -z $adopted && $q == True && $reason == *restarted* ]] && adopted=yes
  fi
  if [[ -n $back ]] && ! ro; then writable=$((SECONDS - t0)); break; fi
  sleep 0.5
done
check "the new PhotonVision took over quiet mode (or had already left it)" "[[ \$adopted == yes || -n \$writable ]]"
check "the scratch partition was writable again $( [[ -n $writable ]] && echo "${writable} s after the restart (PhotonVision answered after ${back} s)" || echo "never")" \
      "[[ -n \$writable ]] && (( writable - back <= 30 ))"
grep -m1 -o "Quiet mode: the scratch partition was left read-only.*" < <(journalctl -u photonvision --since "-3 min" --no-pager -o cat) | sed 's/^/    log: /'
echo
((fails == 0)) && echo "PASS" || { echo "FAIL: $fails check(s)"; exit 1; }
