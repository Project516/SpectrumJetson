#!/usr/bin/env bash
# Builds and tests both versions of the library, and makes the drop-in zips.
#   ./build.sh            test both, then build/drop/*.zip in each build
#   ./build.sh wpilib2026 (or wpilib2027): just one
# Needs JDK 17 and JDK 25. It looks for them where the WPILib installers put them
# (~/wpilib/2026/jdk, ~/wpilib/2027/jdk), and in JAVA17_HOME / JAVA25_HOME.
set -euo pipefail
cd "$(dirname "$0")"
paths=()
for j in "${JAVA17_HOME:-}" "${JAVA25_HOME:-}" "$HOME/wpilib/2026/jdk" "$HOME/wpilib/2027/jdk" "$HOME/build/tools/jdk17"; do
  [[ -n $j && -x $j/bin/java ]] && paths+=("$j")
done
[[ ${#paths[@]} -gt 0 ]] || { echo "No JDK found: install WPILib 2026 and/or 2027, or set JAVA17_HOME / JAVA25_HOME" >&2; exit 1; }
# AdvantageKit's offline Maven repos (for compiling the AdvantageKit example), from GitHub.
deps=$HOME/.cache/spectrum-vision-deps
for v in v26.0.2 v27.0.0-alpha-4; do
  [[ -d $deps/akit-$v/maven_offline ]] && continue
  mkdir -p "$deps/akit-$v"
  echo "Downloading AdvantageKit $v (offline Maven repo, GitHub)"
  curl -fsSL -o "$deps/akit-$v.zip" "https://github.com/Mechanical-Advantage/AdvantageKit/releases/download/$v/maven_offline.zip"
  unzip -q -o "$deps/akit-$v.zip" -d "$deps/akit-$v" && rm "$deps/akit-$v.zip"
done
# PhotonLib 2026.3.4's desktop native library needs GLIBCXX_3.4.32 (GCC 13+'s C++ runtime), and
# Ubuntu 22.04 has 3.4.30, so PhotonLib's simulation can't start there. For the simulation test
# only, this uses the Ubuntu Toolchain PPA's newer libstdc++ built for 22.04 (it needs glibc 2.34;
# Ubuntu 24.04's needs 2.38), checked against the PPA's package index. Nothing system-wide
# changes: the copy goes in the test's own library folder.
if [[ $(uname -s) == Linux ]] && ! grep -q GLIBCXX_3.4.32 /lib/x86_64-linux-gnu/libstdc++.so.6 2>/dev/null &&
   [[ ! -f $deps/libstdcxx/x/usr/lib/x86_64-linux-gnu/libstdc++.so.6 ]]; then
  mkdir -p "$deps/libstdcxx" && (
    cd "$deps/libstdcxx"
    ppa=https://ppa.launchpadcontent.net/ubuntu-toolchain-r/test/ubuntu
    echo "Downloading a newer libstdc++ for the simulation test (this system's is too old for PhotonLib)"
    curl -fsSL -o Packages.gz "$ppa/dists/jammy/main/binary-amd64/Packages.gz"
    entry=$(zcat Packages.gz | awk '/^Package: libstdc\+\+6$/{f=1} f&&/^(Filename|SHA256):/{print $2} f&&/^$/{exit}')
    file=$(sed -n 1p <<<"$entry") sha=$(sed -n 2p <<<"$entry")
    curl -fsSL -o pkg.deb "$ppa/$file"
    echo "$sha  pkg.deb" | sha256sum -c --quiet - && dpkg-deb -x pkg.deb x && rm pkg.deb
  ) || echo "WARNING: couldn't get a newer libstdc++; the simulation test will fail on this system"
fi
# Gradle itself runs on the first JDK found (17 or newer).
export JAVA_HOME=${JAVA_HOME:-${paths[0]}}
csv=$(IFS=,; echo "${paths[*]}")
projects=("${@:-wpilib2026 wpilib2027}")
tasks=()
for p in ${projects[*]}; do tasks+=(":$p:test" ":$p:sourceDrop"); done
# The simulation test needs this machine's native libraries: 2026's run on Ubuntu 22.04 and newer
# (2027's desktop natives need a newer C++ runtime than 22.04 has, so the 2027 copy only compiles).
[[ " ${projects[*]} " == *wpilib2026* ]] && tasks+=(":wpilib2026:simTest")
exec ./gradlew --console=plain -Porg.gradle.java.installations.paths="$csv" -Porg.gradle.java.installations.auto-download=false "${tasks[@]}"
