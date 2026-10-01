#!/usr/bin/env bash
# SpectrumJetson (09-robot-tuning.sh FAN=off): keeps the fan stopped for a fanless heatsink, but
# runs it at full speed if the hottest sensor reaches ON_C, until it is back under OFF_C. The chip
# itself throttles at 99 C and shuts down at 104.5 C; this steps in well before either.
# Installed as /usr/local/bin/spectrum-fan-guard and run by spectrum-fan-guard.service.
ON_C=${ON_C:-90} OFF_C=${OFF_C:-80}
pwm=$(ls /sys/devices/platform/pwm-fan*/hwmon/hwmon*/pwm1 2>/dev/null | head -1)
[[ -n $pwm ]] || { echo "no pwm-fan found"; exit 1; }
want=0 hot_state=0
while true; do
  hot=0
  for z in /sys/class/thermal/thermal_zone*/temp; do
    t=$(cat "$z" 2>/dev/null) || continue
    (( t > hot )) && hot=$t
  done
  c=$((hot / 1000))
  if (( hot_state == 0 && c >= ON_C )); then
    hot_state=1 want=255
    echo "hottest sensor ${c} C: fan on (full speed) until under ${OFF_C} C"
  elif (( hot_state == 1 && c < OFF_C )); then
    hot_state=0 want=0
    echo "hottest sensor ${c} C: fan off again"
  fi
  # Re-asserted every loop, so nothing else (nvfancontrol, a manual test) leaves it changed.
  [[ $(cat "$pwm") == "$want" ]] || echo "$want" > "$pwm"
  sleep 2
done
