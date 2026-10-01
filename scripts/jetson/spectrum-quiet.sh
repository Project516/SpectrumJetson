#!/usr/bin/env bash
# SpectrumJetson (photonvision-56, quiet mode): stop or start writing to the scratch partition.
# PhotonVision runs it (as root) once Rewind has stopped and its log file is closed. Installed as
# /usr/local/bin/spectrum-quiet by 10-data-partition.sh.
#
#   on    system log to RAM, then the scratch partition read-only (retried for 3 s: files still
#         closing). If something still writes there it says what, puts things back, and fails.
#   off   scratch partition writable again; the system log moves back to it in the background.
set -uo pipefail
SCR=/data/scratch
STATE=/run/spectrum-quiet

mountpoint -q "$SCR" || { echo "scratch partition not mounted: nothing to do"; exit 0; }

case ${1:-} in
  on)
    sync
    journalctl --relinquish-var 2>/dev/null
    for _ in $(seq 15); do
      if mount -o remount,ro "$SCR" 2>/dev/null; then
        echo "quiet since $(date +%T)" > "$STATE"
        echo "scratch partition read-only"
        exit 0
      fi
      sleep 0.2
    done
    # Still busy: name what holds files open for writing, and undo.
    busy=$(fuser -vm "$SCR" 2>&1 | awk 'NR > 1 {print $NF}' | sort -u | tr '\n' ' ')
    journalctl --flush 2>/dev/null &
    echo "scratch partition still busy (open by: ${busy:-unknown})"
    exit 1
    ;;
  off)
    mount -o remount,rw "$SCR" || { echo "couldn't remount $SCR writable"; exit 1; }
    rm -f "$STATE"
    # Moving the RAM log back can take a second; nothing waits for it.
    (journalctl --flush 2>/dev/null &)
    echo "scratch partition writable"
    ;;
  *) echo "usage: $0 on|off" >&2; exit 2 ;;
esac
