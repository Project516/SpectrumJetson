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
- **The shop network (`spectrum3847` Wi-Fi) blocks `frcmaven.wpi.edu`.** Fortinet
  FortiGuard DNS filtering resolves it to a block page (`2620:101:9000:53::55`, cert
  `CN = Fortiguard SDNS Blocked Page`), so Java reports a PKIX/SSL error. Gradle builds
  that need WPILib artifacts (the PhotonVision fork, GradleRIO robot code) must run on
  another network, or the domain needs allowlisting. GitHub and
  maven.photonvision.org are not blocked.

## Vision stack: 2026 CUDA fork on the Jetson, 2027 robot code

**Target event:** October 2026 off-season, playing as **team 8515**. Robot code is
[`Spectrum3847/2026-FM-SystemCore`](https://github.com/Spectrum3847/2026-FM-SystemCore)
(WPILib 2027.0.0-alpha-6 on a **SystemCore**, vendordep `photonlib v2027.0.0-alpha-2`).
The field is the **2026 Rebuilt AndyMark** layout, on the Jetson and in robot code.

**Decision:** the Jetson runs the **unmodified 2026** `FRC-Team-4143/photonvision` fork
(`d8c9e8e`, WPILib 2026.2.1) with 971's CUDA detector. The robot uses **stock**
photonlib alpha-2. This works because everything on the wire is identical between the
fork's base and the alpha-6 era (checked in source on 2026-09-23, not yet on hardware):

- **Serde hashes match** (`PhotonPipelineResult` = `4b2ff16a964b5e2bf04be0c1454d91c4`,
  and all sub-messages). PhotonLib only throws on a hash mismatch; a different
  version string just logs.
- **NT4:** the same subprotocol, port 5810 and encoding. 2026 and 2027 clients both
  try `10.TE.AM.2` first, so SystemCore is `10.85.15.2`.
- **Time sync:** the same UDP 5810 packet layout and microsecond timebase.

> **Do not upgrade the robot's photonlib past the alpha-6 era.** PhotonVision `main`
> after alpha-7 (`a6167b0`, 2026-09-17) renamed the timestamp fields, which changed the
> hashes, and the robot would throw against this Jetson.

Porting CUDA to 2027 PhotonVision was rejected. 2027 allwpilib needs JDK 25, C++23
and GCC 13 (Ubuntu 24.04), while JetPack 6 has GCC 11.

| Piece | Version | Built on | Script |
|---|---|---|---|
| allwpilib | `v2026.2.1` (not `main`: `wpi/jni_util.h` moved) | Jetson, `-j4` (more OOMs on wpimath); **17 min** in MAXN SUPER | `scripts/jetson/04-build-allwpilib.sh` |
| GpuDetectorJNI | `FRC-Team-4143` `ef9fc1e`, CUDA arch 87 → `/usr/lib/lib971apriltag.so` | Jetson | `scripts/jetson/05-build-gpudetector.sh` |
| PhotonVision fork jar | `d8c9e8e`, Java 17 target | Laptop (Node 22, pnpm 10, Temurin 17, as in CI) | `scripts/host/03-build-photonvision-fork.sh` |
| Java runtime | **17** for the fork (the PV 2027 installer made 25 the default) | systemd drop-in `photonvision.service.d/java17.conf` | `scripts/jetson/06-install-fork-jar.sh <jar>` |

`scripts/jetson/03-photonvision.sh` installs upstream `v2027.0.0-alpha-2` (CPU only).
That's a placeholder, and it provides the systemd service; the fork jar replaces its
jar.

Known detector rough edges: per-detection `std::cout` in the hot path, and a maximum
of 10 detector handles per process, never recycled. The native lib casts a `jlong` to
`cv::Mat*` compiled against JetPack's OpenCV 4.8 headers while PhotonVision runs its
bundled OpenCV 4.10. That's fine while `cv::Mat`'s layout is unchanged, but fragile.

## First CUDA results (2026-09-23)

One Thriftiest Cam, 1280×800 MJPEG, AprilTagCuda pipeline. Timing comes from
`gpudetector-timing-stats.patch` (`971 stats …` lines in `journalctl -u photonvision`).

| Stage | Cost | Limit |
|---|---|---|
| Camera, 1280×800 MJPEG (measured with `v4l2-ctl --stream-mmap`, PV stopped) | n/a | ~120 fps |
| **Exposure.** The UI's "µs" is really **100 µs units** (V4L2 `exposure_time_absolute`); 295 = 29.5 ms | n/a | ~34 fps at 295; ~50 fps at 100; ~61–63 fps at ≤83 |
| PhotonVision capture (MJPEG decode → BGR → gray, streams) | ~16 ms/frame | **~63 fps (current bottleneck)** |
| 971 CUDA detector | **1.8–3.5 ms/frame** | 300+ fps |

- **Exposure under shop lights:** mains lighting flickers at 120 Hz (8.33 ms). Under
  about 70 (7 ms), detections looked unstable in the UI, yet the raw detector found the
  tag in **100% of frames** at every exposure from 30 to 295. The flicker comes from
  PhotonVision's decision-margin filter (default 35), not from detection. Use **~83**
  in the shop, and lower the decision margin if needed. Retune on the event field.
- **The camera has no UVC gain control**, only exposure and brightness.
- Other teams on Chief Delphi report the same ~32–36 fps with an idle GPU (thread
  483803). 4143 reported 2×1280×800 at 55 fps each.

- **3D mode needs a calibration at the active resolution** (ChArUco, in the Calibration
  tab). The intrinsics also feed the 971 detector via `setparams`.
- **Stray CUDA error** (a known CCCL 2.5 behavior, [NVIDIA/cccl#1791](https://github.com/NVIDIA/cccl/issues/1791)).
  After switching pipeline type and resolution while running,
  every frame logged `Check failed: cub::DeviceSelect::If(...) (invalid device
  ordinal)`. CUB checks `cudaPeekAtLastError()`, so a *stale* error from an unchecked
  call (e.g. the unchecked `cub::DeviceReduce::ReduceByKey`) makes the peak-filter
  select bail out and use stale data, while detections still appear.
  [`patches/gpudetector-cuda-peek.patch`](patches/gpudetector-cuda-peek.patch) clears
  pending errors after each stage and logs the first one per stage as
  `CUDA_PEEK after <stage>`. After a clean restart the error hasn't come back, so
  the root cause is still unconfirmed. If it reappears, the log names the stage.
- Streams render in Firefox; the in-app browser pane doesn't show them.
- The camera is on the devkit's single onboard USB 2.0 hub (all 4 USB-A ports), so
  two cameras will share 480 Mbps.

## Detector source: where the current 971 code lives (research, 2026-09-23)

- `frc971/971-Robot-Code` is **archived**. Austin Schuh's live code is in
  **RealtimeRoboticsGroup/aos `frc/orin/`** (HEAD `8d8a7315e`), used by 4646/1868.
  971's own CMake/nvcc build of it for CUDA 12.6 / sm_87 is
  **frc971/bos `third_party/971apriltag`**, and frc971/cos adds CUDA 13 shims.
- The 4143 copy matches upstream from about 2024-08-11. It is missing, among others,
  **`3e570d5a` (a memory leak on every quad decode)**, `86f0ac3f` (32-bit types),
  `8e7d6743` (async memcpy) and the `76d8f216` tuning.
- **4143 JNI bugs:** detector slots are never reused, so after 10 creates it uses
  `detectors[-1]` (UB), which pipeline switches and resolution changes can trigger;
  `delete` is used on an `apriltag_detector_t`; the tag family leaks; `CHECK_CUDA`
  only prints.
- `mashed26/GpuDetectorJNI` has a better JNI layer (handle map, proper destroy,
  CCCL 3), but a different Java API, so it isn't a drop-in replacement.

## Detector builds: which lib971apriltag.so is which

Both expose the same Java API, so the PhotonVision fork jar works with either.
Swap by installing one to `/usr/lib/lib971apriltag.so` and restarting `photonvision`.

| Build | Source | Script | Status |
|---|---|---|---|
| **4143 + patches** (fallback) | FRC-Team-4143/GpuDetectorJNI `ef9fc1e` (≈971 code of 2024-08) + `patches/gpudetector-0{1,2,3}` | `05-build-gpudetector.sh` (installs) | Running; leak, handle and stale-error fixes applied |
| **bos / Austin's current** (**installed**, robot config) | frc971/bos `62e93b4` `third_party/971apriltag` = RealtimeRoboticsGroup/aos `frc/orin` detector as of `8736ba62` (2026-03-30) + 971's `absl::Status` returns + `patches/bos-01`; JNI in `detector/` | `07-build-bos-detector.sh` then `08-select-detector.sh bos --mwbd 20` | A/B tested and fault tested (below) |

aos is the upstream source of truth. The only detector change in aos since bos
imported it (2026-04-03) is `c1c3b4607` (M_PI → std::numbers::pi, cosmetic).

### A/B results (2026-09-23, one camera, 1280×800 MJPEG, tag held still)

`tests/detector-ab/run.sh` (stats averaged over 6 s per row):

| Build | min_white_black_diff | Exposure | FPS | Detect | Tags/frame | Decision margin |
|---|---|---|---|---|---|---|
| 4143 + patches | 5 | 30 | 62.8 | 2.40 ms | 1.00 | n/a |
| 4143 + patches | 5 | 83 | 61.1 | 3.01 ms | 1.00 | n/a |
| bos | 5 | 30 | 62.8 | 2.39 ms | 1.00 | 43.9 |
| bos | 5 | 83 | 61.1 | 3.03 ms | 1.00 | 118.5 |
| **bos** | **20** | 30 | 62.8 | **1.71 ms** | 1.00 | 43.8 |
| **bos** | **20** | 83 | 61.2 | **1.79 ms** | 1.00 | 118.5 |

- **Selected for the robot: bos, `min_white_black_diff` 20**
  (`08-select-detector.sh bos --mwbd 20`). The detector is 30–40% faster, with
  identical detection and margins. FPS is capture-bound either way.
- **Decision margin tracks exposure:** about 44 at 3 ms vs about 118 at 8.3 ms. With
  PhotonVision's default cutoff of 35, short exposures under shop lights sit close to
  the cutoff, which is why tags flickered. Pick exposure and cutoff together.

### Two cameras, Low Latency Mode (2026-09-23)

- **Low Latency Mode off** (PhotonVision's non-blocking capture) with one camera:
  61 → **~100 fps** at the same ~18 ms latency, but Java CPU 113% → 191%. With it
  on, the capture loop waited for each frame and missed every other one.
- **Two Thriftiest Cams**, both 1280×800 MJPEG, exposure 83, AprilTagCuda, bos
  mwbd 20, Low Latency off: **~92 fps each, ~20 ms latency**, 1.00 tags/frame,
  margins ~122, 0 errors. Java uses ~2.8 of 6 cores (one core ~98% on MJPEG decode),
  GPU 18%, 55 °C, 10.3 W. The shared USB 2.0 hub handles both at full resolution.
- **The cameras are indistinguishable to software:** same name (`Thrifty:`) and serial
  (`01.00.00`). PhotonVision tells them apart by USB port: `Thrifty:_` is on port 2.1
  (`/dev/video0`), `Thrifty:_ (1)` on port 2.3 (`/dev/video2`). **Keep each camera in
  its port**, or calibrations and robot-to-camera transforms swap.

### Calibration board (2026-09-23)

The team's board is a ChArUco, DICT_5X5, 30 mm squares, 22 mm markers. It's labeled
"9x12", but in PhotonVision it must be entered as **Board Width 12, Board Height 9**.
9×12 recovers 0 corners and makes mrcal fail with "Negative corner in reprojection
error calc" or null intrinsics. Use Tag Family `Dict_5X5_1000`, Pattern Spacing
**1.181 in**, Marker Size **0.866 in** (this PV version takes inches), and Old OpenCV
Pattern **off** (9 rows is odd, so both layouts are identical). Verified with
`tests/charuco-board-check/check_board.py` on a live frame: 78/88 corners, 51/54 markers.

Calibration uses its own camera settings. It switched to auto exposure at 20, which
gave a near-black image. Set Auto Exposure off and Exposure ~150 in the calibration card.

### CUDA error handling (bos build)

- `patches/bos-01-nonfatal-cuda.patch`: `CHECK_CUDA` throws instead of `LOG(FATAL)`.
  The JNI skips the frame and rebuilds the detector on the next one.
- If frames fail continuously for 1 s, the JNI calls `_exit(1)` and systemd restarts
  PhotonVision. It uses `_exit`, not `abort()`: SIGABRT went through the JVM crash
  handler and Apport, which took 28 s and wrote a 156 MB `/var/crash` report.
- The service runs Java with `-XX:-CreateCoredumpOnCrash` (06-install-fork-jar.sh),
  so real native crashes also restart quickly.
- Measured with fault injection (`echo N > /tmp/spectrum-971-fault-every`):
  - **1 error per 100 frames:** no restart, 99% of frames still detected, ~59 fps.
  - **Every frame failing:** exits after 1.7 s, detecting again 6.2 s later. That is
    about 8 s total, vs about 62 s before the fixes.

Still open: `use_neon` (a CPU NEON threshold absl flag) is untested and off.

## Changes from the handoff

- **JetPack 6.2 → 6.2.3 (L4T 36.4.3 → 36.5.2).** Same Ubuntu 22.04 / CUDA 12 line,
  with bug fixes. JetPack 7.2.x now supports Orin, but it moves the Jetson to
  Ubuntu 24.04 / CUDA 13, which the fork and detector were not built for.
- The flash command adds `--erase-all`, per the 36.5.2 Quick Start.
- allwpilib is pinned to `v2026.2.1` instead of `main`.
- CUDA isn't part of a BSP-only flash; install `nvidia-jetpack` after first boot.
- The 2026 fork runs against 2027 alpha-6 robot code (see above).

## Open questions

1. Robot network: static IP for the Jetson on `10.85.15.x` (e.g. `.11`), or DHCP?
2. Answered: PhotonVision runs as a boot service (`photonvision.service`).
3. Answered: the fork is 2026-only, and it's used as-is (see above).
