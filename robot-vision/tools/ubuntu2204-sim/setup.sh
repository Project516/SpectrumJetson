#!/usr/bin/env bash
# One-time setup for WPILib robot simulation on an Ubuntu 22.04 laptop (2026 and 2027 projects).
# Covers ./gradlew simulateJava, VS Code's "Simulate Robot Code" and robot tests that load the HAL.
#
#   setup.sh           install (safe to run again; run it again after pulling changes here)
#   setup.sh --remove  uninstall
#
# What it does (nothing system-wide, and no sudo):
#   1. get-libstdcxx.sh: downloads a newer libstdc++ built for 22.04 into ~/.cache/spectrum-vision-deps.
#   2. Copies glibc238_compat.py there, and spectrum-ubuntu2204-sim.gradle into ~/.gradle/init.d.
#      Every GradleRIO build on this machine then fixes the desktop libraries it unpacks into
#      build/jni, just before they're used. See the .gradle file.
#   3. If WPILib 2027 was installed by hand to ~/wpilib/2027, links ~/wpilib/2027_alpha5 to it.
#      GradleRIO 2027.0.0-alpha-6 and its VS Code extension look in ~/wpilib/2027_alpha5, for the
#      offline Maven repo among other things.
# On Ubuntu 24.04 or newer none of this is needed, and the init script does nothing there.
set -eo pipefail
here=$(cd "$(dirname "$0")" && pwd)
deps=${SPECTRUM_VISION_DEPS:-$HOME/.cache/spectrum-vision-deps}
init=${GRADLE_USER_HOME:-$HOME/.gradle}/init.d/spectrum-ubuntu2204-sim.gradle

if [[ $1 == --remove ]]; then
  rm -f "$init" "$deps/ubuntu2204-sim/glibc238_compat.py"
  echo "Removed $init. (The downloaded libstdc++ stays in $deps/libstdcxx; delete it if you like.)"
  exit 0
fi
if grep -q GLIBC_2.38 /lib/x86_64-linux-gnu/libc.so.6 2>/dev/null; then
  echo "This system has glibc 2.38 or newer: simulation works without this. Nothing to do."
  exit 0
fi
"$here/get-libstdcxx.sh"
mkdir -p "$deps/ubuntu2204-sim" "$(dirname "$init")"
install -m 644 "$here/glibc238_compat.py" "$deps/ubuntu2204-sim/glibc238_compat.py"
install -m 644 "$here/spectrum-ubuntu2204-sim.gradle" "$init"
echo "Installed $init"
if [[ -d $HOME/wpilib/2027 && ! -e $HOME/wpilib/2027_alpha5 ]]; then
  ln -s 2027 "$HOME/wpilib/2027_alpha5"
  echo "Linked ~/wpilib/2027_alpha5 -> 2027 (where GradleRIO 2027 alpha-6 looks)"
fi
echo "Done. In a robot project: ./gradlew simulateJava (or VS Code: WPILib: Simulate Robot Code)."
