# SpectrumJetson

Imaging and setup for a **Jetson Orin Nano Super Developer Kit** (P3768 carrier +
P3767-0005 8GB module) running PhotonVision with FRC 971's CUDA AprilTag detector,
for Spectrum 3847/8515. Boots from NVMe, with no SD card.

Original brief: [docs/HANDOFF-jetson-flash.md](docs/HANDOFF-jetson-flash.md).
Where this README disagrees with it, this README wins (see *Changes from the handoff*).

## Target

| | |
|---|---|
| JetPack | **6.2.3** |
| Jetson Linux (L4T) | **36.5.2**, Ubuntu 22.04, kernel 5.15, CUDA 12 |
| Board config | `jetson-orin-nano-devkit-super` |
| Storage | NVMe (`nvme0n1p1`), QSPI bootloader updated during the flash |
| MAXN SUPER | `sudo nvpmodel -m 2` (0 = 15W, 1 = 25W default, 2 = MAXN_SUPER) |

Settings shared by the scripts live in [config.env](config.env).

## Flashing (from an Ubuntu 22.04 x86-64 host)

1. **Download** the BSP and sample rootfs into `~/nvidia/r36.5.2/`:
   ```bash
   mkdir -p ~/nvidia/r36.5.2 && cd ~/nvidia/r36.5.2
   B=https://developer.nvidia.com/downloads/embedded/l4t/r36_release_v5.2/releases
   curl -fLO $B/Jetson_Linux_r36.5.2_aarch64.tbz2
   curl -fLO $B/Tegra_Linux_Sample-Root-Filesystem_r36.5.2_aarch64.tbz2
   ```
2. **Prepare the BSP** (extract, host prerequisites, apply binaries, create the default
   user). Prompts for username, hostname and password:
   ```bash
   scripts/host/01-prepare-bsp.sh
   ```
3. **Put the Jetson in Force Recovery Mode:**
   - Leave the USB-C data cable connected from the carrier's USB-C port to the host.
   - Unplug barrel power.
   - Jumper **FC REC** to **GND** (pins 9 and 10) on the **12-pin button header J14**.
     It's under the module on the carrier edge. It is *not* the 40-pin GPIO header.
   - Plug power in, wait about 2 s, and remove the jumper.
   - `lsusb` should now show `0955:7523 NVIDIA Corp. APX`.
4. **Flash:**
   ```bash
   scripts/host/02-flash-nvme.sh
   ```
   This takes about 10-20 minutes and writes a log to `logs/`. It temporarily stops
   NetworkManager from managing the Jetson's USB network interface and opens ufw
   for `fc00:1:1::/48`, then restores both.
5. **Get into the Jetson.** After the flash it boots from NVMe and shows up over the
   USB-C cable as `0955:7020`. The Jetson is `192.168.55.1`; the host gets
   `192.168.55.100` by DHCP. Install a key so later steps can run over SSH:
   ```bash
   ssh-keygen -t ed25519 -N "" -f ~/.ssh/jetson_ed25519   # once per host
   ssh-copy-id -i ~/.ssh/jetson_ed25519.pub spectrum3847@192.168.55.1
   ```
   Copy the scripts over:
   ```bash
   tar czf - --exclude=logs --exclude=.git . | ssh -i ~/.ssh/jetson_ed25519 spectrum3847@192.168.55.1 'mkdir -p ~/SpectrumJetson && tar xzf - -C ~/SpectrumJetson'
   ```
6. **Verify, then enable MAXN SUPER** (on the Jetson):
   ```bash
   ~/SpectrumJetson/scripts/jetson/01-verify.sh
   ```
   Expected: all three PASS lines, and `nvpmodel -q` reports `MAXN_SUPER` / `2`. At
   idle, `tegrastats` shows all 6 CPU cores at 1728 MHz. The mode persists across
   reboots (`/var/lib/nvpmodel/status` = `pmode:0002`); `jetson_clocks` does not.
7. **Get the Jetson online.** It has no internet over USB, and its clock is wrong
   until NTP syncs, which breaks apt's TLS. Wi-Fi is easiest; the password is prompted
   for, not echoed:
   ```bash
   sudo nmcli --ask dev wifi connect <SSID> ifname wlP1p1s0
   ```
8. **Install JetPack components** (CUDA/cuDNN/TensorRT) and the build environment
   (on the Jetson):
   ```bash
   ~/SpectrumJetson/scripts/jetson/02-jetpack.sh
   ```

## Gotchas seen on the first flash (2026-09-23)

- **Recovery-mode header:** the 12-pin J14 is tucked under the module. The 40-pin
  header is the wrong one.
- **Password leak:** NVIDIA's `l4t_create_default_user.sh` prints the password in
  plain text. `01-prepare-bsp.sh` now masks it. Change the password with `passwd`
  after first boot if it was ever shown.
- **"Waiting for target to boot-up..."** repeats for about 30 s while the flashing
  initrd boots. That's normal. The flash is only done at `Flash is successful`,
  once the QSPI write after "Successfully flashed the external device" finishes.
  Don't unplug the board at the external-device message.
- **Harmless flash warnings:** "backup GPT table is corrupt", missing
  `/dev/mmcblk0boot0` (there's no eMMC), "Skip writing ... no image is specified".
- The whole flash took about 7 minutes on a 16-core host.

## Vision stack (not yet scripted)

- PhotonVision fork: `FRC-Team-4143/photonvision`. The `jetson-orin` and `main`
  branches are identical at `d8c9e8e` (2026-01-30), based on WPILib **2026.2.1**.
  Upstream PhotonVision still has no Jetson/CUDA support, so the fork is required.
- Detector: `FRC-Team-4143/GpuDetectorJNI` @ `ef9fc1e`, built with CUDA arch 87.
- Build **allwpilib at tag `v2026.2.1`**, not `main`. `main` has moved
  `wpi/jni_util.h`, so GpuDetectorJNI won't compile against it. The tag also
  matches the fork's `wpilibVersion`, which avoids a runtime ABI mismatch with
  `libwpiutil`.
- Keep `cmake --build . --parallel 4` for allwpilib; higher can OOM on wpimath.
- Known detector rough edges: per-detection `std::cout` in the hot path; a maximum
  of 10 detector handles per process, which are never recycled.

## Changes from the handoff

- **JetPack 6.2 → 6.2.3 (L4T 36.4.3 → 36.5.2).** Same Ubuntu 22.04 / CUDA 12 line,
  with bug fixes. JetPack 7.2.x now supports Orin, but it moves the Jetson to
  Ubuntu 24.04 / CUDA 13, which the fork and detector were not built for.
- The flash command adds `--erase-all`, per the 36.5.2 Quick Start.
- allwpilib is pinned to `v2026.2.1` instead of `main`.
- CUDA isn't part of a BSP-only flash; install `nvidia-jetpack` after first boot.

## Open questions (handoff §9)

1. Robot network: static IP or DHCP/mDNS, and the hostname.
2. Should PhotonVision run as a boot service? (Likely yes.)
3. Is the 4143 fork still current for the 2027 season? It has had no commits since
   2026-01-30, and upstream is already on 2027 alphas with renamed `org.wpilib.*`
   packages.
