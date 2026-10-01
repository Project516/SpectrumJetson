#!/usr/bin/env bash
# SpectrumJetson (09-robot-tuning.sh FAN=off): fanless heatsink. The fan stays stopped: in our setup
# it's sealed under the heatsink plate and moves no air (2026-10-01), so running it only wears it.
# Instead, if the hottest sensor reaches ON_C, this sets /run/spectrum-thermal-limit, and
# PhotonVision (photonvision-57) caps every camera's frame rate until it's back under OFF_C. The
# chip itself throttles at 99 C and shuts down at 104.5 C; this steps in before either.
# FAN_ON_HOT=1 also runs the fan at full speed while hot, for a heatsink the fan can move air through.
# Installed as /usr/local/bin/spectrum-fan-guard and run by spectrum-fan-guard.service.
ON_C=${ON_C:-95} OFF_C=${OFF_C:-88}
FLAG=/run/spectrum-thermal-limit
pwm=$(ls /sys/devices/platform/pwm-fan*/hwmon/hwmon*/pwm1 2>/dev/null | head -1)
[[ -n $pwm ]] || { echo "no pwm-fan found"; exit 1; }
# The kernel drives the fan too: tj-thermal has "active" trips (35, 74, 95 C) bound to the pwm-fan
# cooling device, and at 74 C it set the fan to 88 every few seconds while this set it back to 0,
# so the fan pulsed (seen 2026-10-01). Take the fan away from the kernel: user_space policy on every
# zone with an active trip. Critical trips (104 C shutdown) still act under any policy, and the CPU
# and GPU slow down at 99 C through their own zones. 09-robot-tuning.sh FAN=quiet|full puts
# step_wise back.
for z in /sys/class/thermal/thermal_zone*; do
  grep -qx active "$z"/trip_point_*_type 2>/dev/null || continue
  echo user_space > "$z/policy" 2>/dev/null && echo "$(cat "$z/type"): fan control taken from the kernel (user_space)"
done
rm -f "$FLAG"
# The flag must never outlive the guard: a stale one would keep every camera capped at 60 fps until
# a reboot. The unit's ExecStopPost and 09-robot-tuning.sh remove it too (a SIGKILL skips traps).
trap 'rm -f "$FLAG"' EXIT
hot_state=0
while true; do
  hot=0
  for z in /sys/class/thermal/thermal_zone*/temp; do
    t=$(cat "$z" 2>/dev/null) || continue
    (( t > hot )) && hot=$t
  done
  c=$((hot / 1000))
  if (( hot_state == 0 && c >= ON_C )); then
    hot_state=1
    echo "hot since $(date +%T) at ${c} C" > "$FLAG"
    echo "hottest sensor ${c} C: thermal limit on (PhotonVision caps the cameras) until under ${OFF_C} C"
  elif (( hot_state == 1 && c < OFF_C )); then
    hot_state=0
    rm -f "$FLAG"
    echo "hottest sensor ${c} C: thermal limit off"
  fi
  want=0
  [[ ${FAN_ON_HOT:-0} == 1 && $hot_state == 1 ]] && want=255
  # Re-asserted every loop, so nothing else (nvfancontrol, a manual test) leaves it changed.
  [[ $(cat "$pwm") == "$want" ]] || echo "$want" > "$pwm"
  sleep 2
done
