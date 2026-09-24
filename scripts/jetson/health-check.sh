#!/usr/bin/env bash
# Is the Jetson ready to drive? Run ON THE JETSON (no sudo), e.g. from the laptop:
#   ssh -i ~/.ssh/jetson_ed25519 spectrum3847@<jetson-ip> ~/SpectrumJetson/scripts/jetson/health-check.sh
# Prints PASS / WARN / FAIL per check; exits 1 if anything FAILs.
# Usage: health-check.sh [expected_cameras]   (default 2)
set -uo pipefail

EXPECT=${1:-2}
fails=0 warns=0
pass() { printf "  PASS  %s\n" "$*"; }
warn() { printf "  WARN  %s\n" "$*"; warns=$((warns + 1)); }
fail() { printf "  FAIL  %s\n" "$*"; fails=$((fails + 1)); }

echo "== PhotonVision"
if systemctl is-active --quiet photonvision; then
  P=$(systemctl show photonvision -p MainPID --value)
  up=$(ps -o etimes= -p "$P" | tr -d ' ')
  restarts=$(systemctl show photonvision -p NRestarts --value)
  ver=$(journalctl _PID="$P" --no-pager -o cat 2>/dev/null | grep -m1 -oE "Starting PhotonVision version [^ ]+" | awk '{print $4}')
  pass "running ${up}s, version ${ver:-?}"
  [[ ${restarts:-0} -gt 0 ]] && warn "restarted $restarts time(s) since boot (check: journalctl -u photonvision)"
  LOG=$(journalctl _PID="$P" --no-pager -o cat 2>/dev/null)
else
  fail "photonvision.service is not running (sudo systemctl restart photonvision)"
  P=0 LOG=""
fi

echo "== CUDA detector"
if grep -q "971 library loaded" <<<"$LOG"; then
  pass "$(grep -m1 -o '971 library loaded.*' <<<"$LOG")"
elif grep -q "creategpudetector" <<<"$LOG"; then
  warn "running the 4143 detector build (not Austin's current bos build)"
else
  fail "CUDA detector not loaded (is an AprilTagCuda pipeline selected?)"
fi
recent=$(journalctl _PID="$P" --no-pager -o cat --since "-3 s" 2>/dev/null | grep '^971 stats')
handles=$(grep -oE '^971 stats h[0-9]+' <<<"$recent" | sort -u | awk '{print $3}')
for h in $handles; do
  line=$(grep "^971 stats $h " <<<"$recent" | tail -1)
  fps=$(awk '{for(i=1;i<=NF;i++) if($i=="calls/s,") print int($(i-1))}' <<<"$line")
  det=$(awk '{for(i=1;i<=NF;i++) if($i=="avg" && $(i-1)=="detect") print $(i+1)}' <<<"$line")
  err=$(awk '{for(i=1;i<=NF;i++) if($i=="errors") print $(i+1)}' <<<"$line")
  msg="$h: ${fps} fps, detect ${det} ms"
  if [[ -n $err ]]; then warn "$msg, CUDA errors $err"
  elif [[ ${fps:-0} -lt 30 ]]; then warn "$msg (low fps: exposure too long?)"
  else pass "$msg"; fi
done
[[ -z $handles && $P != 0 ]] && fail "no detector stats in the last 3 s (no CUDA pipeline running?)"
calib8=$(grep -c "setparams handle .*(8 dist coeffs)" <<<"$LOG")
calib5=$(grep -c "setparams handle .*(5 dist coeffs)\|sending 5 of 8" <<<"$LOG")
if [[ $calib8 -ge $EXPECT ]]; then pass "calibration loaded for $calib8 detector(s), 8 lens coefficients"
elif [[ $calib8 -gt 0 ]]; then warn "calibration loaded for only $calib8 of $EXPECT cameras"
elif [[ $calib5 -gt 0 ]]; then warn "calibration loaded with only 5 lens coefficients"
else warn "no calibration loaded (3D mode needs one at the active resolution)"; fi
nfail=$(journalctl _PID="$P" --no-pager -o cat --since "-60 s" 2>/dev/null | grep -c "^971 detector h.* failure")
[[ $nfail -gt 0 ]] && warn "$nfail CUDA detector failures in the last minute"

echo "== Cameras"
DB=/opt/photonvision/photonvision_config/photon.sqlite
# PhotonVision camera nickname bound to a USB port (it matches identical cameras by port).
cam_name() {
  sqlite3 "$DB" "select config_json from cameras;" 2>/dev/null | python3 -c "
import json, sys, re
text = sys.stdin.read()
for chunk in re.split(r'(?m)^\\{', text):
    if 'usb-0:$1:1.0' in chunk:
        m = re.search(r'\"nickname\" : \"([^\"]*)\"', chunk)
        if m: print(m.group(1)); break
" 2>/dev/null
}
cams=0
for intf in /sys/bus/usb/drivers/uvcvideo/*:1.0; do
  [[ -e $intf ]] || continue
  dev=$(dirname "$(readlink -f "$intf")")
  port=$(basename "$dev")
  ctl=$(cat "$dev/power/control")
  speed=$(cat "$dev/speed")
  cams=$((cams + 1))
  hubport=${port#*-}   # 1-2.1 -> 2.1
  name=$(cam_name "$hubport")
  label="${name:-unnamed camera} on USB port $hubport"
  if [[ -z $name ]]; then warn "$label: not configured in PhotonVision (activate it in Camera Matching)"
  elif [[ $ctl == on ]]; then pass "$label (${speed} Mbps, autosuspend off)"
  else warn "$label has autosuspend on (run 09-robot-tuning.sh)"; fi
done
if [[ $cams -lt $EXPECT ]]; then fail "$cams camera(s) found, expected $EXPECT"; fi

echo "== Robot connection"
last_nt=$(grep -E "NT connected to|Could not connect to the robot|disconnected" <<<"$LOG" | tail -1)
team=$(grep -m1 -oE "server team is [0-9]+|server IP is [^ ]+" <<<"$LOG")
if grep -q "NT connected to" <<<"$last_nt"; then
  pass "$(grep -oE 'NT connected to [^!]+' <<<"$last_nt") (${team})"
  if grep -q "Changing TimeSyncClient server to" <<<"$LOG"; then pass "time sync pointed at the robot"
  else warn "time sync has not switched to the robot yet"; fi
else
  warn "not connected to the robot (${team:-no team set}); expected off the robot"
fi
ips=$(ip -4 -br addr | awk '$1 !~ /^(lo|l4tbr0|usb|docker)/ && $3 != "" {print $1" "$3}' | paste -sd',' | sed 's/,/, /g')
echo "        addresses: ${ips:-none}"
if nmcli -t -f DEVICE,TYPE,STATE dev 2>/dev/null | grep -q ":wifi:connected"; then
  warn "Wi-Fi is connected: turn it off before competition (robot coprocessors may not use radios)"
fi

echo "== System"
mode=$(cut -d: -f2 /var/lib/nvpmodel/status 2>/dev/null)
[[ $mode == 0002 ]] && pass "power mode MAXN SUPER" || fail "power mode is ${mode:-unknown}, expected MAXN SUPER (0002)"
cmin=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_min_freq) cmax=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq)
G=$(ls -d /sys/devices/platform/bus@0/17000000.gpu/devfreq/* 2>/dev/null | head -1)
gmin=$(cat "$G/min_freq" 2>/dev/null) gmax=$(cat "$G/max_freq" 2>/dev/null)
if [[ $cmin == "$cmax" && -n $gmin && $gmin == "$gmax" ]]; then pass "clocks locked (CPU $((cmax / 1000)) MHz, GPU $((gmax / 1000000)) MHz)"
else warn "clocks not locked (CPU min $((cmin / 1000)) / max $((cmax / 1000)) MHz): jetson-clocks service?"; fi
hot=0 hotname=""
for z in /sys/class/thermal/thermal_zone*; do
  t=$(cat "$z/temp" 2>/dev/null) || continue
  [[ $t -gt $hot ]] && hot=$t hotname=$(cat "$z/type")
done
tc=$((hot / 1000))
if [[ $tc -ge 85 ]]; then fail "hottest sensor ${hotname} ${tc} C (throttling territory)"
elif [[ $tc -ge 70 ]]; then warn "hottest sensor ${hotname} ${tc} C (check the fan and airflow)"
else pass "hottest sensor ${hotname} ${tc} C"; fi
avail=$(awk '/MemAvailable/ {print int($2 / 1024)}' /proc/meminfo)
[[ $avail -ge 1500 ]] && pass "memory available ${avail} MB" || warn "memory available only ${avail} MB"
disk=$(df -P / | awk 'NR == 2 {print int($5)}')
[[ $disk -lt 85 ]] && pass "disk ${disk}% used" || warn "disk ${disk}% used"
boot=$(systemd-analyze 2>/dev/null | grep -oE '= [0-9.]+s' | tr -d '= ')
[[ -n $boot ]] && echo "        boot time: ${boot} ($(systemctl get-default))"

echo
if [[ $fails -gt 0 ]]; then echo "NOT READY: $fails failure(s), $warns warning(s)"; exit 1; fi
echo "READY${warns:+ ($warns warning(s))}"
