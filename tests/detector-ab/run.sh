#!/usr/bin/env bash
# A/B the CUDA AprilTag detector builds live in PhotonVision, then test that CUDA errors
# don't take PhotonVision down. Run ON THE JETSON with one camera on an AprilTagCuda
# pipeline and a tag held still in view. Asks for sudo once; takes ~4 minutes.
#
# Leaves the bos detector with min_white_black_diff 20 selected.
set -uo pipefail

SEL=$HOME/SpectrumJetson/scripts/jetson/08-select-detector.sh
FAULT=/tmp/spectrum-971-fault-every
EXPOSURES=(30 83)
SETTLE=3
WINDOW=6

sudo -v || exit 1
( while true; do sudo -n true; sleep 30; done ) 2>/dev/null &
KEEPALIVE=$!
trap 'kill $KEEPALIVE 2>/dev/null; rm -f $FAULT' EXIT
rm -f $FAULT

mainpid() { systemctl show photonvision -p MainPID --value; }
since_epoch() { date +%s; }
wait_secs() { local t=$(( $(date +%s) + $1 )); while [ "$(date +%s)" -lt "$t" ]; do sleep 0.5; done; }

# Wait until the current PhotonVision process has printed N stats lines.
wait_for_stats() {
  local n=$1 deadline=$(( $(date +%s) + 90 )) pid
  while [ "$(date +%s)" -lt "$deadline" ]; do
    pid=$(mainpid)
    if [ "$pid" != 0 ] && [ "$(journalctl _PID="$pid" --no-pager -o cat 2>/dev/null | grep -c '^971 stats')" -ge "$n" ]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# Average the stats lines the current process printed in the last WINDOW seconds.
summarize() {
  journalctl _PID="$(mainpid)" --no-pager -o cat --since "-${WINDOW} s" 2>/dev/null | grep '^971 stats' |
    awk '{
      for (i = 1; i <= NF; i++) {
        if ($i == "calls/s,") c += $(i-1)
        if ($i == "avg" && $(i-1) == "detect") d += $(i+1)
        if ($i == "tags/frame") { t += $(i+1) + 0 }
        if ($i == "margin") { m += $(i+2); mc++ }
        if ($i == "errors") e += $(i+1)
      }
      n++
    } END {
      if (!n) { print "no data"; exit }
      printf "%6.1f fps  %5.2f ms  %4.2f tags/frame  margin %s  errors %d\n",
        c/n, d/n, t/n, (mc ? sprintf("%5.1f", m/mc) : "  n/a"), e
    }'
}

run_config() {
  local label=$1; shift
  "$SEL" "$@" >/dev/null
  if ! wait_for_stats 2; then echo "$label: PhotonVision did not come up"; return; fi
  for e in "${EXPOSURES[@]}"; do
    v4l2-ctl -d /dev/video0 --set-ctrl=exposure_time_absolute="$e"
    wait_secs $(( SETTLE + WINDOW ))
    printf "%-14s exp %3s  %s\n" "$label" "$e" "$(summarize)"
  done
}

echo "== A/B (hold the tag still) =="
run_config "4143 mwbd5" 4143
run_config "bos  mwbd5" bos --mwbd 5
run_config "bos  mwbd20" bos --mwbd 20

echo
echo "== Fault test 1: a CUDA error every 100 frames (should skip frames, keep running) =="
pid0=$(mainpid)
echo 100 > $FAULT
wait_secs 12
rm -f $FAULT
pid1=$(mainpid)
fails=$(journalctl _PID="$pid1" --no-pager -o cat --since "-13 s" | grep -c "^971 detector h.* failure")
echo "PID before $pid0, after $pid1 ($([ "$pid0" = "$pid1" ] && echo 'no restart' || echo 'RESTARTED'))"
echo "failures logged: $fails; stats while faulting: $(WINDOW=10 summarize)"

echo
echo "== Fault test 2: every frame fails (should abort once, systemd restarts) =="
wait_for_stats 2
pid0=$(mainpid)
t0=$(date +%s.%N)
echo 1 > $FAULT
# Remove the flag as soon as the abort is logged so the restarted process runs clean.
deadline=$(( $(date +%s) + 30 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  if journalctl _PID="$pid0" --no-pager -o cat 2>/dev/null | grep -q "aborting so systemd restarts"; then break; fi
  sleep 0.2
done
t_abort=$(date +%s.%N)
rm -f $FAULT
deadline=$(( $(date +%s) + 90 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  p=$(mainpid)
  if [ "$p" != 0 ] && [ "$p" != "$pid0" ] && journalctl _PID="$p" --no-pager -o cat 2>/dev/null | grep -q '^971 stats'; then break; fi
  sleep 0.2
done
t_back=$(date +%s.%N)
echo "PID $pid0 -> $(mainpid)"
awk -v a="$t0" -v b="$t_abort" -v c="$t_back" 'BEGIN {
  printf "time to abort after faults began: %.1f s; abort to detecting again: %.1f s\n", b-a, c-b }'

echo
v4l2-ctl -d /dev/video0 --set-ctrl=exposure_time_absolute=83
echo "Done. Selected: bos detector, min_white_black_diff 20 (exposure left at 83)."
