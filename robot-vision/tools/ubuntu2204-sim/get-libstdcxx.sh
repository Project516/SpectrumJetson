#!/usr/bin/env bash
# Downloads a newer C++ runtime for desktop simulation on Ubuntu 22.04, only when this system needs it.
#
# PhotonLib's and WPILib 2027's desktop libraries need GLIBCXX_3.4.32, which comes with GCC 13's
# C++ runtime. Ubuntu 22.04 has 3.4.30. This downloads the Ubuntu Toolchain PPA's libstdc++ built
# for 22.04: it needs glibc 2.34, whereas Ubuntu 24.04's needs 2.38. The download is checked
# against the SHA256 in the PPA's package index, and unpacked to
#   ~/.cache/spectrum-vision-deps/libstdcxx/x/usr/lib/x86_64-linux-gnu/libstdc++.so.6
# Nothing system-wide changes. Only a simulation that puts that folder, or a copy of the file, on
# LD_LIBRARY_PATH uses it. The file is backward compatible with the system's own copy.
#
# It does nothing when the system's copy is new enough, or when the file is already there.
# Used by robot-vision/build.sh and setup.sh.
set -eo pipefail
deps=${SPECTRUM_VISION_DEPS:-$HOME/.cache/spectrum-vision-deps}
out=$deps/libstdcxx/x/usr/lib/x86_64-linux-gnu
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || exit 0
grep -q GLIBCXX_3.4.32 /lib/x86_64-linux-gnu/libstdc++.so.6 2>/dev/null && exit 0
[[ -f $out/libstdc++.so.6 ]] && exit 0
mkdir -p "$deps/libstdcxx"
cd "$deps/libstdcxx"
ppa=https://ppa.launchpadcontent.net/ubuntu-toolchain-r/test/ubuntu
echo "Downloading a newer libstdc++ for simulation (this system's is too old for PhotonLib and WPILib 2027)"
curl -fsSL -o Packages.gz "$ppa/dists/jammy/main/binary-amd64/Packages.gz"
entry=$(zcat Packages.gz | awk '/^Package: libstdc\+\+6$/{f=1} f&&/^(Filename|SHA256):/{print $2} f&&/^$/{exit}')
file=$(sed -n 1p <<<"$entry") sha=$(sed -n 2p <<<"$entry")
[[ -n $file && -n $sha ]] || { echo "libstdc++6 isn't in the PPA's index" >&2; exit 1; }
curl -fsSL -o pkg.deb "$ppa/$file"
echo "$sha  pkg.deb" | sha256sum -c --quiet -
rm -rf x && dpkg-deb -x pkg.deb x && rm pkg.deb Packages.gz
echo "  -> $out"
