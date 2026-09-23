#!/usr/bin/env bash
# Swap the 4143 CUDA PhotonVision fork jar into the photonvision.service created by
# 03-photonvision.sh, and run it on Java 17 (the fork targets 17; the 2027 installer
# made Java 25 the system default).
# Run ON THE JETSON. Usage: 06-install-fork-jar.sh <path/to/photonvision-...-linuxarm64.jar>
set -euo pipefail

JAR=${1:?usage: $0 <photonvision-linuxarm64.jar>}
JAVA17=/usr/lib/jvm/java-17-openjdk-arm64/bin/java
DEST=/opt/photonvision/photonvision.jar

[[ -x $JAVA17 ]] || { echo "Missing $JAVA17 (sudo apt install openjdk-17-jdk)" >&2; exit 1; }
[[ -f /usr/lib/lib971apriltag.so ]] || echo "WARNING: /usr/lib/lib971apriltag.so missing; CUDA pipeline will fail to load." >&2

sudo systemctl stop photonvision

# Keep the jar being replaced, once, so we can roll back.
if [[ -f $DEST && ! -f /opt/photonvision/photonvision.jar.orig ]]; then
  sudo cp "$DEST" /opt/photonvision/photonvision.jar.orig
fi
sudo install -m 644 "$JAR" "$DEST"

# Drop-in override instead of editing the installer's unit. -n = PV does not manage networking.
sudo mkdir -p /etc/systemd/system/photonvision.service.d
sudo tee /etc/systemd/system/photonvision.service.d/java17.conf >/dev/null <<EOF
[Service]
ExecStart=
ExecStart=$JAVA17 -Xmx512m -jar $DEST -n
EOF

sudo systemctl daemon-reload
sudo systemctl start photonvision
sleep 10
systemctl --no-pager --lines=0 status photonvision || true
journalctl -u photonvision --no-pager -n 300 | grep -iE "version|971|cuda|jetson|exception|error" | tail -15 || true

echo
echo "Rollback: sudo cp /opt/photonvision/photonvision.jar.orig $DEST && \\"
echo "  sudo rm /etc/systemd/system/photonvision.service.d/java17.conf && \\"
echo "  sudo systemctl daemon-reload && sudo systemctl restart photonvision"
