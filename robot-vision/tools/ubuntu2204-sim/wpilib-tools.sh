#!/usr/bin/env bash
# Makes WPILib 2027's desktop tools run on Ubuntu 22.04: Glass, SysId, OutlineViewer, DataLogTool
# and wpical. Like the simulation libraries (see setup.sh), they need glibc 2.38 for a few
# functions 22.04 has under older names, and a newer libstdc++.
#
#   wpilib-tools.sh [WPILIB_DIR]            patch (default ~/wpilib/2027). Safe to run again; run it
#                                           again after ToolsUpdater installs new versions.
#   wpilib-tools.sh --restore [WPILIB_DIR]  put the original programs back
#
# Inside WPILIB_DIR/tools:
#   ubuntu2204/original/NAME   the program as shipped, untouched
#   ubuntu2204/NAME            a copy patched by glibc238_compat.py, next to the newer libstdc++.so.6
#   NAME                       a short script that runs the patched copy with that libstdc++
#   Glass, SysId, ...          links to those scripts, named as in tools.json. The WPILib VS Code
#                              extension's "Start Tool" looks for these names, but the 2027 programs
#                              ship lowercase.
# Nothing outside WPILIB_DIR/tools changes. Needs setup.sh's libstdc++ (it runs get-libstdcxx.sh).
set -eo pipefail
here=$(cd "$(dirname "$0")" && pwd)
restore=0
[[ $1 == --restore ]] && { restore=1; shift; }
tools=${1:-$HOME/wpilib/2027}/tools
[[ -f $tools/tools.json ]] || { echo "No WPILib tools in $tools" >&2; exit 1; }
fix=$tools/ubuntu2204
mapfile -t names < <(python3 -c 'import json,sys; [print(t["name"]) for t in json.load(open(sys.argv[1])) if t.get("cpp")]' "$tools/tools.json")

if ((restore)); then
  for n in "${names[@]}"; do
    bin=${n,,}
    [[ -L $tools/$n ]] && rm "$tools/$n"
    [[ -f $fix/original/$bin ]] && mv -f "$fix/original/$bin" "$tools/$bin"
  done
  rm -rf "$fix"
  echo "Restored the original programs in $tools"
  exit 0
fi

if grep -q GLIBC_2.38 /lib/x86_64-linux-gnu/libc.so.6 2>/dev/null; then
  echo "This system has glibc 2.38 or newer: the tools run as shipped. Nothing to do."
  exit 0
fi
"$here/get-libstdcxx.sh"
cxx=${SPECTRUM_VISION_DEPS:-$HOME/.cache/spectrum-vision-deps}/libstdcxx/x/usr/lib/x86_64-linux-gnu/libstdc++.so.6
[[ -f $cxx ]] || { echo "No newer libstdc++ ($cxx)" >&2; exit 1; }
mkdir -p "$fix/original"
cp -L "$cxx" "$fix/libstdc++.so.6"
for n in "${names[@]}"; do
  bin=${n,,}
  # A real program here is new (first run, or ToolsUpdater replaced our script): keep it as the original.
  if [[ -f $tools/$bin ]] && head -c 4 "$tools/$bin" | grep -q ELF; then
    mv -f "$tools/$bin" "$fix/original/$bin"
  fi
  [[ -f $fix/original/$bin ]] || { echo "  $n: not installed, skipped"; continue; }
  cp "$fix/original/$bin" "$fix/$bin.new"
  python3 "$here/glibc238_compat.py" "$fix/$bin.new" >/dev/null || { rm -f "$fix/$bin.new"; echo "  $n: can't be fixed (see above)"; continue; }
  mv -f "$fix/$bin.new" "$fix/$bin"
  cat > "$tools/$bin" <<EOF
#!/bin/sh
# Runs the copy of $bin patched for Ubuntu 22.04 (SpectrumJetson robot-vision/tools/ubuntu2204-sim/wpilib-tools.sh).
dir=\$(dirname "\$(readlink -f "\$0")")/ubuntu2204
LD_LIBRARY_PATH="\$dir\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}" exec "\$dir/$bin" "\$@"
EOF
  chmod +x "$tools/$bin"
  [[ $n != "$bin" ]] && ln -sfn "$bin" "$tools/$n"
  # (ldd lists the weakened GLIBC_2.38 requirement as "weak version ... not found": that's expected.)
  missing=$(LD_LIBRARY_PATH=$fix ldd "$fix/$bin" 2>&1 | grep "not found" | grep -v "weak version" || true)
  [[ -z $missing ]] && echo "  $n: ok" || echo "  $n: still missing: $missing"
done
