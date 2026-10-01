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
# Gradle itself runs on the first JDK found (17 or newer).
export JAVA_HOME=${JAVA_HOME:-${paths[0]}}
csv=$(IFS=,; echo "${paths[*]}")
projects=("${@:-wpilib2026 wpilib2027}")
tasks=()
for p in ${projects[*]}; do tasks+=(":$p:test" ":$p:sourceDrop"); done
exec ./gradlew --console=plain -Porg.gradle.java.installations.paths="$csv" -Porg.gradle.java.installations.auto-download=false "${tasks[@]}"
