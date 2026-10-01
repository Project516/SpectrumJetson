#!/usr/bin/env bash
# SpectrumVision's input path against real PhotonVision output (LiveCheck.java). Run ON THE JETSON,
# after copying robot-vision's jar to /tmp/spectrum-vision.jar and PhotonLib's to /tmp/photonlib.jar:
#   tests/robot-vision-live/run.sh [SECONDS]
# Starts fake cameras (a synthetic session with tags) and the fake robot, runs the check, and puts
# the real cameras back.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
SECS=${1:-15}
JAVA=/usr/lib/jvm/java-17-openjdk-arm64/bin/java
if [[ -z ${RVL_UNDER_TIMEOUT:-} ]]; then
  rc=0; RVL_UNDER_TIMEOUT=1 timeout --kill-after=20 $((SECS + 300)) "$0" "$@" || rc=$?
  [[ $rc == 124 ]] && echo "TIMEOUT" >&2
  exit "$rc"
fi
for f in /tmp/spectrum-vision.jar /tmp/photonlib.jar; do [[ -f $f ]] || { echo "missing $f" >&2; exit 2; }; done
started_robot=0
cleanup() {
  "$ROOT/scripts/jetson/fake-cameras.sh" stop >/dev/null 2>&1 || echo "WARNING: fake-cameras.sh stop failed" >&2
  if [[ $started_robot == 1 ]]; then touch /tmp/fake-robot-stop; wait "$robot_pid" 2>/dev/null; fi
}
trap cleanup EXIT
if ! pgrep -f FakeRobot.java >/dev/null; then
  "$ROOT/tests/fake-robot/run.sh" "disabled:$((SECS + 200))" >/tmp/rvl-robot.log 2>&1 &
  robot_pid=$!; started_robot=1
fi
"$ROOT/scripts/jetson/fake-cameras.sh" start || exit 1
sleep 20
"$JAVA" -cp /opt/photonvision/photonvision.jar:/tmp/photonlib.jar:/tmp/spectrum-vision.jar "$HERE/LiveCheck.java" "$SECS" 2>&1 | grep -v "^NT:"
