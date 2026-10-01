#!/usr/bin/env bash
# Sets up a freshly flashed Jetson from this laptop, with nobody at the Jetson:
#
#   scripts/host/prestage-rootfs.sh     # once per laptop: sudo, Wi-Fi, SSH key into the image
#   scripts/host/02-flash-nvme.sh       # Jetson in Force Recovery Mode, ~7 min
#   scripts/host/setup-jetson.sh [--settings photon.sqlite] [--model model.onnx]
#
# It waits for the Jetson to boot, copies this repo, the PhotonVision jar (building it if there
# isn't one in out/), and any settings or model over, then runs scripts/jetson/install.sh there
# under nohup (an SSH drop doesn't stop it) and follows its progress. About an hour. Run it again
# after a failure: install.sh carries on from the failed step.
#
# JETSON (default 192.168.55.1, the USB-C link). The user, key, FAN and CAP come from config.env
# (or the environment) and are passed through to install.sh.
set -euo pipefail
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
source "$REPO_ROOT/config.env"
JETSON=${JETSON:-192.168.55.1}
U=$JETSON_USER
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=5 -i "$KEY" "$U@$JETSON")
SETTINGS="" MODEL=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --settings) SETTINGS=$2; shift 2 ;;
    --model) MODEL=$2; shift 2 ;;
    *) sed -n '2,16p' "$0"; exit 2 ;;
  esac
done

echo "==> Waiting for the Jetson at $JETSON (up to 10 min)"
end=$((SECONDS + 600))
until timeout 3 bash -c "echo > /dev/tcp/$JETSON/22" 2>/dev/null; do
  (( SECONDS < end )) || { echo "TIMEOUT: no SSH at $JETSON after 10 min" >&2; exit 1; }
  sleep 3
done
# A fresh flash has a new host key: replace the old one for this address only.
ssh-keygen -R "$JETSON" >/dev/null 2>&1 || true
ssh-keyscan -T 5 "$JETSON" 2>/dev/null >> ~/.ssh/known_hosts
"${SSH[@]}" true || { echo "Key login refused: run prestage-rootfs.sh before flashing, or ssh-copy-id -i $KEY.pub $U@$JETSON" >&2; exit 1; }

JAR=$(ls -t "$REPO_ROOT"/out/*linuxarm64.jar 2>/dev/null | head -1 || true)
if [[ -z $JAR ]]; then
  echo "==> Building the PhotonVision jar"
  timeout 1200 "$REPO_ROOT/scripts/host/03-build-photonvision-fork.sh"
  JAR=$(ls -t "$REPO_ROOT"/out/*linuxarm64.jar | head -1)
fi

echo "==> Copying the repo, $(basename "$JAR")${SETTINGS:+, settings}${MODEL:+, model}"
RS=(rsync -a -e "ssh -o BatchMode=yes -i $KEY")
timeout 600 "${RS[@]}" --delete --exclude out/ --exclude node_modules/ --exclude .claude/ \
  --exclude logs/ --exclude 'tests/ui/.state/' "$REPO_ROOT/" "$U@$JETSON:SpectrumJetson/"
"${SSH[@]}" 'mkdir -p ~/restore'
timeout 600 "${RS[@]}" "$JAR" "$U@$JETSON:restore/"
ARGS=(--jar "restore/$(basename "$JAR")")
if [[ -n $SETTINGS ]]; then
  timeout 300 "${RS[@]}" "$SETTINGS" "$U@$JETSON:restore/photon.sqlite"
  ARGS+=(--settings restore/photon.sqlite)
fi
if [[ -n $MODEL ]]; then
  timeout 600 "${RS[@]}" "$MODEL" "$U@$JETSON:restore/"
  ARGS+=(--model "restore/$(basename "$MODEL")")
fi

echo "==> Running install.sh on the Jetson (log: ~/install-logs-run.out there, per-step logs in ~/install-logs/)"
"${SSH[@]}" "cd ~ && FAN=$FAN ${CAP:+CAP=$CAP} nohup SpectrumJetson/scripts/jetson/install.sh ${ARGS[*]} > install-logs-run.out 2>&1 < /dev/null & echo started"
# Follow it. install.sh has its own per-step time limits; this outer limit is their sum plus slack.
end=$((SECONDS + 5 * 3600)) seen=0
while (( SECONDS < end )); do
  sleep 20
  out=$("${SSH[@]}" 'cat ~/install-logs-run.out 2>/dev/null' 2>/dev/null) || continue
  n=$(wc -l <<<"$out")
  (( n > seen )) && { tail -n +$((seen + 1)) <<<"$out"; seen=$n; }
  grep -q -E "^Setup finished|^FAILED|^TIMEOUT" <<<"$out" && break
  "${SSH[@]}" 'pgrep -f "[s]cripts/jetson/install.sh" >/dev/null' 2>/dev/null || { echo "install.sh stopped without finishing: see ~/install-logs-run.out on the Jetson"; exit 1; }
done
grep -q "^Setup finished" <<<"$out" || exit 1
