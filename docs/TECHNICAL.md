# SpectrumJetson: technical reference

Imaging and setup for a **Jetson Orin Nano Super Developer Kit** (P3768 carrier +
P3767-0005 8GB module) running PhotonVision with FRC 971's CUDA AprilTag detector,
for Spectrum 3847/8515. Boots from NVMe, with no SD card.

Technical reference for the setup. For the student-friendly overview, start with the [README](../README.md). Original brief: [HANDOFF-jetson-flash.md](HANDOFF-jetson-flash.md).
Where this document disagrees with the brief, this document wins (see *Changes from the handoff*).

## Target

| | |
|---|---|
| JetPack | **6.2.3** |
| Jetson Linux (L4T) | **36.5.2**, Ubuntu 22.04, kernel 5.15, CUDA 12 |
| Board config | `jetson-orin-nano-devkit-super` |
| Storage | NVMe (`nvme0n1p1`), QSPI bootloader updated during the flash |
| MAXN SUPER | `sudo nvpmodel -m 2` (0 = 15W, 1 = 25W default, 2 = MAXN_SUPER) |

Settings shared by the scripts live in [config.env](../config.env).

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
`gpudetector-02-timing-stats.patch` (`971 stats …` lines in `journalctl -u photonvision`).

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
  [`patches/gpudetector-01-cuda-peek.patch`](../patches/gpudetector-01-cuda-peek.patch) clears
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

### Lens distortion: all 8 coefficients (2026-09-24)

PhotonVision's calibration (mrcal) produces the 8-coefficient OpenCV rational model
(`k1 k2 p1 p2 k3 k4 k5 k6`). The 4143 fork passed only the first 5 to the CUDA
detector, which uses the model to undistort tag edges during corner refinement and then
re-distort the corners. `photonvision-04-dist-coeffs-8.patch` adds `setparams8`
(implemented in `detector/GpuDetectorJNI.cc`), and the log now shows
`setparams handle N (8 dist coeffs)`. It falls back to 5 if the 4143 library is installed.

Bench calibrations (`tests/calibration-check/check_calibration.py`): camera on port 2.1:
43 snapshots, 97% of corners kept, mean 0.87 px, fx 737.8, cx/cy 650.5/362.4. Camera on
port 2.3: 41 snapshots, 96% kept, mean 0.97 px, fx 737.0, cx/cy 597.9/371.6. Handheld
calibrations wouldn't go below ~0.8 px. The outlier rate is the useful quality signal:
42% when the board hung off the frame, 3–4% when it stayed inside and touched the edges.

### Robot tuning and boot time (2026-09-24)

`scripts/jetson/09-robot-tuning.sh` (`--undo` reverses it):
- apt timers disabled, plus an APT::Periodic override
- snapd masked (no snaps installed; `snapd.seeded` took 45 s of every boot)
- `multi-user.target` default (headless)
- `jetson-clocks.service` (After=nvpmodel, Before=photonvision)
- a udev rule setting `power/control=on` for every uvcvideo device

Measured after reboot:

| | Before | After |
|---|---|---|
| `systemd-analyze` | 56.9 s (6.9 kernel + 50.0 userspace) | **16.5 s** (9.0 + 7.6) |
| PhotonVision started (s since kernel start) | ~12 (it never waited on snapd) | 14.7 (now after jetson_clocks) |
| First detection, cameras 1 / 2 | not measured | **19.9 / 20.1 s** |

Everything survived the reboot: MAXN SUPER, clocks locked (CPU 1728 MHz, GPU 1020 MHz),
camera autosuspend off, the bos detector (mwbd 20), and both calibrations (8
coefficients). `health-check.sh` reports READY; the only warnings are no robot and Wi-Fi on.

JVM (`tests/jvm-check.sh`, 2 cameras at ~90 fps): 28 MB peak heap of 512 MB, 0 GCs in
20 s, 787 MB RSS (native frame memory). `-Xmx512m` stays.

### Blank frames and the watchdog (2026-09-24)

- **Bug:** with zero candidate blobs, `num_selected_blobs_host == 0`, and `FitLines` computed
  `kBlocks = 0` and launched `<<<0, 128>>>`. That invalid configuration surfaced in the
  peak-filter `cub::DeviceSelect::If` (apriltag.cc:1013) as status 101 on every frame.
  `bos-02-empty-frame.patch` returns no detections early and guards `FitLines`.
  `tests/detector-frame-sizes/run.sh`: blank frames at 1280x800, 640x480, 320x240, 800x600
  and 1280x720 all failed before; all pass after. Noise frames always passed.
- **Watchdog:** on failure, the JNI calls `cudaDeviceSynchronize()`. It exits (for a systemd
  restart) only if the context stays broken for 1 s. Fault tests: 1 error per 100 frames →
  no restart; an error on every frame → **no restart**, 94 fps with 0 errors once it stops;
  sticky null-pointer kernel fault → exit after 1.3 s, detecting again 6.5 s later.
- **Team defaults:** `photonvision-06` now picks the resolution once the camera reports its
  video modes (they're empty when the pipeline is first created). Verified: "team default
  resolution 1280x800 kMJPEG @ 120 fps (mode 13)".
- **3D and multi-tag follow the calibration:** new cameras get `doMultiTarget = true`. When a
  calibration is saved or imported (`addCalibrationToConfig`), or a new camera's resolution
  is picked, every AprilTag/AprilTagCuda pipeline whose resolution now has a calibration gets
  `solvePNPEnabled = true` and multi-tag on. Never turns either off. (3D stays off without a
  calibration because the pose pipes have no intrinsics then.) Verified: TopLeft switched to
  2D, same calibration re-imported through `/api/calibration/importFromData` → "turned on 3D
  and multi-tag for pipeline "New Pipeline"", 97–103 fps after. Found because TopLeft had
  lost 3D, and both cameras had multi-tag off, after TopLeft was re-created as BottomLeft.

### Rewind recording (2026-09-24)

`patches/photonvision-07-rewind.patch`; the full description is in [REWIND.md](REWIND.md).

- **How it records.** It adds a per-camera `RewindRecorder` in `USBFrameProvider`: a second cscore `RawSink` on the `UsbCamera`, left at `kUnknown` pixel format, so `GetExistingImage(0)` hands over the camera's own MJPEG bytes. No decode, no re-encode.
- **Threads.** One thread per camera, at nice 10 via `renice` on `/proc/thread-self`. It keeps a frame if ≥ 1/fps − 2 ms has passed since the last kept frame (30 fps).
- **Control.** `RewindManager` runs a 5 Hz tick: robot NT `record` (plus a 60 s grace period if the robot disconnects) or the UI's bench switch. It also enforces the quota and minimum free space. Files go to `/opt/photonvision/rewind`.
- **Measured** (2 cameras, `tests/rewind-ab/run.sh 30 2`): detector fps 108–110 / 99–100 off, and the same with recording on; detect time 1.5–1.9 ms either way. Rewind threads use 2.9% of one core. Frames are 30–55 KB; TopRight's view compresses better.
- **WPILib bug:** `RawFrame.getSize()` returns the limit of a Java `ByteBuffer` that is only replaced when the native data pointer changes. `WPI_AllocateRawFrameData` frees and mallocs, which often returns the same address, and it doesn't reallocate at all when the frame fits the capacity. So the limit stuck at the first frame's size: every frame was 51,677 bytes, with no EOI marker. Fix: `RawFrame.setData()` with our own 4 MB direct buffer (the JNI gives it a no-op free), and the real length from the JPEG (walk the marker segments, then the first `FFD9` in the scan data). Verified: 1,005/1,005 frames complete, sizes 54.3–54.8 KB, the AVI decodes end to end in GStreamer.
- **Export** (`scripts/host/rewind-export.py`). A plain-Python MJPEG AVI writer (RIFF `hdrl`/`movi`/`idx1`, split under 2 GB), plus `frames.csv` with `jetson_us` and `robot_us`. Optional H.264 `.mp4` via ffmpeg's concat demuxer with per-frame durations.
- **Download** (`GET /api/rewind/download?session=NAME`, the button in the Rewind card). `RewindExport` streams a zip: stored entries (deflate level 0), with each AVI's layout computed from the CSV index first so it's written in one pass. The handler thread runs at nice 10 while sending. Its AVI is byte-for-byte identical to `rewind-export.py`'s (checked on a 1,005-frame recording). The response has no `Content-Encoding`, so Javalin doesn't gzip it. Speed: 70 MB/s single, 125 MB/s back to back over USB. Cost while downloading: detector fps 93 → 78 (TopLeft) and 105 → 92 (TopRight), from kernel network/softirq time that nice doesn't cover. Not throttled: downloads only happen with the robot disabled.
- **Not yet verified:** `robot_us` (Jetson time + `TimeSyncManager.getOffset()`) needs the robot network.

### Power-cut safety (2026-09-24)

The robot is switched off, never shut down, so every power-off is a power cut.

- **Filesystem.** ext4 with its journal (default `data=ordered`, barriers on), and the NVMe's volatile write cache honors flushes. A cut leaves the filesystem consistent; the kernel replays the journal at the next mount.
- **No boot-time fsck.** The L4T initrd mounts root read-write itself (`init` `_mount_root`), so `systemd-fsck-root` is skipped, and the initrd has no `e2fsck`. Adding one means modifying NVIDIA's initrd, which an L4T update would overwrite, so it isn't done. Instead, `health-check.sh` FAILs if `/sys/fs/ext4/<dev>/errors_count` is non-zero. The repair is restoring the backup image.
- **Writeback.** Changed from 30 s / 5 s to `vm.dirty_expire_centisecs=300` and `vm.dirty_writeback_centisecs=100` (`09-robot-tuning.sh` step 6): written data reaches the SSD within ~3 s.
- **System log.** It was RAM-only (`/var/log/journal` didn't exist), so every cut erased it, including the log of a brownout. Now `Storage=persistent`, `SyncIntervalSec=5s`, `SystemMaxUse=300M`.
- **Rewind.** The video file, then the index, are forced to the SSD every 2 s and on close; `session.json` is synced too. Cost: ~0.7% of the recording's frames come late (5 of 704) when a sync blocks the recorder thread. Detector fps is unchanged.
- **Test.** `tests/power-cut/run.sh` (laptop): records, you pull the plug, then after boot it checks the ext4 errors and journal replay, the log from before the cut, PhotonVision's health, and the seconds of video lost.
- **Clock.** No RTC battery on the devkit: after a cut the clock restarts at **1970** until NTP (Wi-Fi) corrects it. That confuses `journalctl -b -1` (use `_BOOT_ID=`), and Rewind names made before NTP carry a 1970 date; their leading number is what orders them.
- **Result (2026-09-24, power pulled 21.4 s into a bench recording):** 0 ext4 errors; the kernel logged `1 orphan inode deleted` / `recovery complete` (the journal replayed, normal after a cut). The old boot's log survived up to 3 s before the cut, including PhotonVision's lines. PhotonVision came back healthy (90 / 105 fps, both calibrations with 8 coefficients). The recording kept 20.0 s of 21.4 s: **1.4 s lost**, every saved frame a complete JPEG. `session.json` has no end, as expected.

### Jetson clock from the robot (2026-09-24)

`patches/photonvision-08-robot-clock.patch` (`RobotClockSync`, 1 Hz).

- **Where the time comes from.** Robot code publishes `/photonvision/clock/unixMs` (integer, `System.currentTimeMillis()`) once the Driver Station has set the robot's clock. The Jetson has no RTC battery and no internet at events, so this is its only source.
- **When it sets the clock.** When the value is 2026–2100, less than 5 s old (NT local receive timestamp) and more than 1 s off. At most once per 30 s, with `date -u -s @…` (PhotonVision runs as root).
- **Internet time wins.** Skipped if `/run/systemd/timesync/synchronized` exists, i.e. timesyncd got NTP time this boot (shop Wi-Fi). The first bench test showed why: timesyncd noticed the jump and put NTP time back within a second, so a wrong robot clock and NTP would fight every 30 s. At events there's no NTP, so the robot's clock is used.
- **Bench test (fake robot 120 s fast, before the NTP rule):** `Clock set from the robot: was 04:57:20, now 04:59:20 (+120.0 s)`, with that log line itself stamped 04:59:20, so the clock really moved. timesyncd then restored NTP time.
- **Next boot.** It then touches `/var/lib/systemd/timesync/clock`; timesyncd moves the clock up to that file's modification time at boot, so after a power cut the Jetson starts near the last robot time, not 1970.
- **Not for vision.** Frame timestamps, the PhotonVision↔robot time sync and Rewind frame times use `nt::Now` (monotonic), which setting the date doesn't move. It fixes Rewind names, the system log, and file dates.
- **Robot half:** [2026-FM-SystemCore#10](https://github.com/Spectrum3847/2026-FM-SystemCore/issues/10), section 6.
- **Test:** `tests/robot-clock/run.sh` (a fake robot NT server on the Jetson).

### Match readiness: fan, watchdog, camera unplug, backups (2026-09-24)

- **Fan.** NVIDIA's `quiet` profile ran the fan at ~2,000 rpm at 56 °C. The profile tables in `/etc/nvfancontrol.conf` are inverted (PWM 255 = off) and it's hard to tell which profile cools harder at a given temperature, so instead `jetson-clocks.service` runs `jetson_clocks --fan`: it stops nvfancontrol and sets `pwm1=255`. It's ordered `After=nvfancontrol.service`, so nvfancontrol can't take the fan back at boot. After a reboot: pwm 255, 5,586 rpm, hottest sensor **56 → 43 °C** (2 cameras, bench). `health-check.sh` reads the real speed from the tachometer (the `pwm_tach` hwmon), not just `pwm1`, which is only what the fan was told: FAIL under 1,000 rpm while the fan is told to spin (unplugged, jammed or dead), WARN under 4,500 rpm at full speed (5,586–6,327 rpm seen), WARN if nvfancontrol is running or `pwm1` isn't full.
- **Hangs.**
  - `RuntimeWatchdogSec=30s` in `/etc/systemd/system.conf.d/zz-spectrum-watchdog.conf`. NVIDIA's own `watchdog.conf` sets 120; systemd reads the files in name order and the last one wins, so ours is named `zz-`.
  - `kernel.panic=3`. NVIDIA already sets `panic_on_oops=1`, but the default `panic=0` means a panic hung until the watchdog fired.
  - PhotonVision `Restart=always`, `StartLimitIntervalSec=0`.
  - All four checked after a reboot.
- **Camera unplug** (`tests/camera-replug/run.sh`, TopLeft pulled for 7.4 s):
  - cscore saw the disconnect at once and retried every ~0.3 s; TopRight kept detecting.
  - After re-plugging: reconnected at 1280x800 in 0.35 s, detecting again on the same detector handle (calibration kept) in 0.9 s, full 105 fps within 2 s.
  - This kernel logs a re-plug as `new high-speed USB device number N`, not `New USB device found`.
- **Backups.**
  - `scripts/host/04-backup-ssd.sh` wraps NVIDIA's `tools/backup_restore/l4t_backup_restore.sh -e nvme0n1 -b`: the Jetson boots a small system over the USB-C cable in recovery mode and NFS-mounts `tools/backup_restore`. The APP partition is saved as a `tar.zst` of its files, the rest with `dd`. The script also saves PhotonVision's settings export, `jetson-info.txt` and `SHA256SUMS`, and refuses to run with more than 1 GB of Rewind recordings on the SSD.
  - First backup (2026-09-24): 21 GB used on the SSD → 8.7 GB backup, about 7 minutes. Afterwards the Jetson stays in NVIDIA's backup system (USB `0955:7035`) until it's power-cycled.
  - `05-restore-ssd.sh` checks the checksums and asks you to type `restore`. It *moves* the backup into `tools/backup_restore/images` for the restore (a symlink wouldn't resolve over NFS on the Jetson) and moves it back afterwards.
  - Both need the same host tweaks as flashing (NetworkManager, ufw) plus udisks2 stopped.
  - A restore can target a blank spare SSD. The QSPI bootloader isn't in the backup, so a replacement *module* needs `02-flash-nvme.sh` first. **Not run yet.**

### Fanless: stock heatsink with the fan off (2026-09-24)

Question: can a sealed, fanless Jetson survive matches? Both tests used the stock devkit heatsink on the bench with `pwm1=0` (0 rpm), MAXN SUPER, clocks locked, each stopped by a safety cutoff. Throttling starts at **99 °C** (CPU/GPU `passive` trips), shutdown at 104.5 °C. The 70 °C trip is only `hot-surface-alert`.

- **Power** (`VDD_IN`): 8.6–9.5 W with 2 cameras detecting, 6.8 W with PhotonVision stopped, 5.7 W with the clocks unlocked too (all at ~40 °C; each rises ~0.5 W by 80 °C). Idle is 60–70% of full power, so throttling while disabled helps less than you'd expect.
- **Full power, fan off:** 42 → 85 °C in 9.7 min, still rising 2.3 °C/min. No throttling.
- **Match cycle, fan off:** 15 min with PhotonVision stopped (7.2 W), then full power: 40 → 63.5 °C at 5 min, 73.7 at 10, 80.5 at 15, then **88 °C after 2 min 39 s** of full power (cutoff).
- **Model** (one RC node fitted to both runs, within 0.8 °C): 6.2 °C/W, time constant 6.6 min, steady state **99 °C at full power**, 85 °C at 7.2 W. Peak at the end of a 4-minute full-power match after being on disabled at 7.2 W: 67 °C (0 min), 80 (5 min), 86 (10 min), ~90 (20+ min). It ran ~1.5 °C under the measured peak.
- **Takeaway:** the stock heatsink alone isn't enough; the duty cycle only helps if the robot isn't on long before the match. A fanless design needs roughly **4 °C/W or better** (by the same model: ≤ 73 °C worst case), and should be tested with this match cycle in its real enclosure. A dead fan isn't fatal: the Jetson slowly climbs to its throttle point instead of shutting down.
- **Throttling while disabled** already works from robot code: `PhotonCamera.setEnabled(false)` (patch 11) or a robot-set FPS limit. If Rewind is used, keep full rate until its 10 s tail ends.

### Decode speedup (2026-09-24)

Full write-up in [VISION-RESEARCH.md](VISION-RESEARCH.md).

- **Profile.** `tests/cpu-profile.sh` (per-thread CPU plus 40 jstack samples):
  - each camera's VisionRunner thread was running 98% of the time, 85% of samples in `CscoreExtras.grabRawSinkFrameTimeoutLastTime`;
  - 5 native threads inherited the name (OpenCV's pthreads pool) at ~22% each.
- **Cause.**
  - cscore 2026.2.1 `Frame::ConvertImpl` turns MJPEG into BGR first (`ConvertMJPEGToBGR`, then `ConvertBGRToGray`) for any requested format. `ConvertMJPEGToGray` (Frame.cpp:406) is never called.
  - Measured on recorded frames: JPEG→BGR→gray 8.9 ms against libjpeg-turbo gray-only 2.6 ms (2.2 ms with the fast IDCT; we keep the accurate one).
- **Fix (`photonvision-09` plus `decodeMjpegGray` in `detector/GpuDetectorJNI.cc`).**
  - PhotonVision grabs through the gray sink with `setInfo(0,0,0,kUnknown)`, so it gets the camera's MJPEG image untouched.
  - The detector library decodes it with libjpeg-turbo (`JCS_GRAYSCALE`, `JDCT_ISLOW`, a longjmp error handler) into a CV_8UC1 Mat that Java allocated.
  - Gotcha: `CscoreExtras.grabRawSinkFrameTimeoutLastTime` fills only the *native* `WPI_RawFrame`; the Java `RawFrame`'s format, size and data stay unset. The first attempt read those, dropped every frame, and broke detection until it was fixed.
  - 30 failures in a row put that camera back on cscore's conversion.
- **OpenCV pool.** `09-robot-tuning.sh` step 9 sets `OPENCV_THREAD_POOL_ACTIVE_WAIT_WORKER=0` and `..._MAIN=0` (the bundled `libopencv_core.so.4.10` reads both).
- **Results** (2 cameras, stream closed, `tests/perf-snapshot.sh`):

  | Stage | fps (TopLeft / TopRight) | CPU |
  |---|---|---|
  | Before | 92 / 104 | 333% |
  | Decode fix | 121 / 121 | ~195% |
  | + OpenCV pool | 122 / 122, 1.6 ms detect | **129%** |

  UI latency went from ~23 ms to **13 ms**.
- **GPU load, 2 cameras at 122 fps** (`tegrastats` every 0.5 s for 30 s, GPU locked at 1020 MHz, capped camera driver, measured after the backup reboot): mean 12%, median 14%, p90 22%, max 24%. Detect 1.95 / 2.16 ms, PhotonVision CPU 145% with one stream open.
- **CUDA wait mode** (`SPECTRUM_971_CUDA_SYNC` or `/tmp/spectrum-971-cuda-sync`), measured with the decode fix:

  | Mode | CPU | Detect time |
  |---|---|---|
  | spin | ~192% | 1.6 / 2.1 ms |
  | block | ~199% | 1.9 / 2.5 ms |
  | yield | ~200% | 2.2 / 2.5 ms |

  The default stays `auto` (CUDA's own, spins). Re-test with 4 cameras.
- **Camera stuck after rapid restarts.** After 4 PhotonVision restarts in 3 minutes, TopRight sent only corrupt frames: cscore logged "invalid JPEG image received from camera" 120 times a second, and nothing reached the pipeline. One more restart fixed it. `health-check.sh` now warns about this, and when fewer detectors report than cameras are plugged in.
- **Exposure 50 (5 ms), decision margin 15** (team-tuned), now the new-camera defaults (`photonvision-10`). `tests/flicker-check`: 0.6% average and 1% maximum frame-to-frame brightness change under the shop LEDs, so no flicker.

### Dashboard stream only when watched (`photonvision-15`, 2026-09-24)

PhotonVision's stream thread shrinks, colour-converts and draws on every frame for the dashboard, even when no browser is watching, and it used to get every frame (122 fps). Now `VisionModule` hands it a frame only while a stream has a viewer (cscore enables a source only while an MjpegServer client streams from it) or a snapshot is pending, and at most `SPECTRUM_STREAM_FPS` a second (default 30; 0 = every frame). Snapshots are never delayed.

| 2 cameras, hardware decode on | PhotonVision CPU | Stream |
|---|---|---|
| Before, no viewer | 0.49 cores | |
| After, no viewer | **0.43 cores** | |
| Before, one viewer | 0.52 cores | 121 fps |
| After, one viewer | **0.47 cores** | 30 fps |

Tested: snapshots with no viewer (the websocket `saveInputSnapshot`/`saveOutputSnapshot` commands the UI sends) still saved both images. They're 213x133, because snapshots were always taken from the shrunken stream image.

### Hardware JPEG decode: NVJPG (2026-09-24)

The camera JPEGs can be decoded on the Orin Nano's two NVJPG engines instead of the CPU, both gray (AprilTags) and colour (game pieces, driver mode, calibration). It's switched on with `08-select-detector.sh bos --mwbd 20 --jpeg nvjpg`, with libjpeg-turbo as the fallback. The research and the pitfalls are in [VISION-RESEARCH.md](VISION-RESEARCH.md).

- **How it works (gray).** It's the same Java call, `decodeMjpegGray`, so no jar change was needed for AprilTag cameras. The detector library hands each JPEG to `libspectrumnvjpg.so` (`detector/NvJpgDecoder.cc`):
  - libnvjpeg decodes into its own buffer (`IsVendorbuf`), and CUDA copies the Y plane into PhotonVision's Mat (0.24 ms).
  - libnvjpeg cycles through 4 buffers behind one fd number. Each gets its own CUDA registration, keyed by its dmabuf inode.
  - It's a separate library because libnvjpeg exports libjpeg-turbo's function names. `lib971apriltag.so` loads it with `dlopen(RTLD_DEEPBIND)`.
  - There's one decoder per camera thread.
  - **MJPEG mode (`cinfo.mjpeg_decode = TRUE`) is required.** Without it, libnvjpeg leaked ~250 KB every frame: PhotonVision grew to 5.6 GB and was OOM-killed twice (2026-09-24). NVIDIA's own NvJPEGDecoder class sets it. With it, each decoder takes ~180 MB once and then stays flat: 8 minutes in PhotonVision with 2 cameras, ~116,000 frames, RSS 1.078 → 1.092 GB.
- **How it works (colour, `photonvision-18`).** When the hardware decoder is on, `USBFrameProvider` takes the camera's raw JPEG for colour frames too, and calls `decodeMjpegBgr`. The hardware decodes to Y/Cb/Cr planes, then a CUDA kernel (`detector/nvjpg_bgr.cu`) converts them to BGR with libjpeg's own arithmetic ("fancy" chroma upsampling and the jdcolor.c tables). So the pixels are identical to cscore's decode, and the safety-net check can be exact. Only 4:2:2 JPEGs, which UVC cameras send, use the hardware; others go to libjpeg-turbo. With the decoder off (`hardwareJpegDecode()` false), colour frames stay on cscore's own path.
- **Measured in PhotonVision** (2 cameras at 122 fps, bench scene, no tags):

  | Decoder | PhotonVision CPU | Decode per frame |
  |---|---|---|
  | libjpeg-turbo | 0.84–0.86 cores | 2.0 ms |
  | NVJPG | **0.52 cores** | 2.6 ms |

  The engine takes ~2.3 ms whatever the scene; it already runs at its 499.2 MHz maximum. libjpeg-turbo's time grows with detail: 2.9 ms on our recorded frames, 2.0 ms on this plain bench scene. Detect times and fps didn't change.

  **Colour** (TopRight in driver mode at 120 fps, TopLeft on AprilTags): PhotonVision used **0.59 cores** with the hardware colour decode (3.1 ms a frame), against **1.12 cores** with cscore's own decode. That's about half a core saved per colour camera at 120 fps.
- **Memory cost:** ~180 MB per camera (libnvjpeg's decoder). With 4 cameras, PhotonVision should sit near 1.5 GB instead of ~0.7 GB.
- **Safety net.**
  - A frame the hardware can't decode goes to libjpeg-turbo. After a decode error the decoder is re-created.
  - Every 240 hardware frames per camera (~2 s), a low-priority thread decodes the same JPEG with libjpeg-turbo and compares every pixel. Any difference turns the hardware decoder off until PhotonVision restarts (`971 jpeg: HARDWARE DECODE DIFFERS`). Frames libjpeg-turbo warns about (corrupt ones) aren't compared.
  - A CUDA error in the decoder also turns it off. The detector's watchdog handles a broken context as before.
  - `health-check.sh` shows the decoder in use, its checks, fallbacks and any difference. It also warns when PhotonVision uses over 2.5 GB, or was OOM-killed since boot.
- **Logs.** A `971 jpeg` line every 10 s: frames/s and ms for each decoder, fallbacks, and checks since start, plus a `colour:` clause when colour frames were decoded.
- **Tested.**
  - `tests/jpeg-hw/run.sh`: every frame of the Rewind recordings identical to libjpeg-turbo, in gray and in BGR; bad input (truncated, corrupted, garbage, not a JPEG, wrong size, empty), each followed by a good frame that decodes on the hardware; format changes; 4 decoders at once; and memory growth (fails over 64 MB). **Run it after every L4T update.**
  - Colour content: our cameras are mono, so `tests/jpeg-hw/make-colour-recordings.py` pans across real colour photos already on the Jetson (Ubuntu wallpapers, OpenCV samples) and writes 4:2:2 recordings at quality 50/80/95 plus 4:2:0 and 4:4:4 ones. All 2,038 colour 4:2:2 frames came out identical to libjpeg-turbo; 4:2:0 and 4:4:4 were refused, as they should be. **Re-run it with a real colour camera's Rewind recording when one arrives.**
  - Safety net: `touch /tmp/spectrum-jpeg-fault` changes one pixel of every hardware frame. The next check caught it, the hardware turned off, and both cameras stayed at 122 fps.
  - Sticky CUDA fault (`echo sticky > /tmp/spectrum-971-fault-every`): the decoder fell back to libjpeg-turbo, the watchdog restarted PhotonVision after 1 s, and it came back on the hardware.
- **Switches.**
  - `SPECTRUM_JPEG_DECODER=nvjpg`, set by `08-select-detector.sh --jpeg nvjpg`. Without it, libjpeg-turbo.
  - A/B without a restart: `echo turbo > /tmp/spectrum-jpeg-decoder` (or `nvjpg`). It's read every 2 s; `rm` it to go back to the setting.
- **Rollback.** `08-select-detector.sh bos --mwbd 20` without `--jpeg` goes back to libjpeg-turbo, and colour frames go back to cscore. The libraries from before are `/usr/lib/lib971apriltag.so.pre-nvjpg` (before any hardware decode) and `*.pre-colour` (before the colour path and the leak fix).
- **Measured and dropped: the detector reading the decoder's buffer directly.** bos's `Detect(host, device)` takes a GPU pointer, and detections were identical on 2,856 frames. Against this path it skips the copy into PhotonVision's Mat (0.27 ms) and the detector's upload (0.16 ms). But the detector's first kernel reads the decoder's buffer 3x slower (0.21 against 0.07 ms), and its CPU step reads that uncached buffer too (+0.13 ms). Net: ~0.15 ms and ~0.1 ms of CPU a frame, plus ~0.15 ms more from PhotonVision skipping its full-size copies. Not worth a PhotonVision patch. (End-to-end totals in the harness were noisy: our test decodes queued behind PhotonVision's live decodes on the same engines. The per-step times above are consistent between runs.)
- **Not done yet:** 4 real cameras, and a real colour camera.

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

### Jetson telemetry and camera mount estimate (2026-09-24)

`photonvision-16` and `photonvision-17`, plus `nativeJpegStatus` in `detector/GpuDetectorJNI.cc`.
Robot-side use is in [issue #10](https://github.com/Spectrum3847/2026-FM-SystemCore/issues/10).

**Jetson, `/photonvision/jetson/`, every 1 s** (`JetsonTelemetry`):

| Topic | Type | Source |
|---|---|---|
| `gpuLoadPct` | double | `/sys/devices/platform/bus@0/17000000.gpu/load` (per mille) |
| `cpuTempC`, `gpuTempC`, `tjTempC`, `socTempC` | double | thermal zones `cpu-`, `gpu-`, `tj-thermal`; hottest of `soc0..2-thermal` |
| `fanRpm` | double | hwmon `pwm_tach` `rpm` |
| `powerW`, `cpuGpuPowerW`, `socPowerW` | double | INA3221 rails `VDD_IN` (board input), `VDD_CPU_GPU_CV`, `VDD_SOC` (mV x mA) |
| `jpegDecoder` | string | `nvjpg` or `libjpeg-turbo` (the decoder in use) |
| `jpegHardwareOff` | boolean | the hardware decoder was switched off (a check differed, or CUDA failed) |
| `jpegChecksOk`, `jpegChecksDiffer` | integer | hardware-vs-CPU frame checks since start |
| `throttle` | string | why the Jetson is slowing itself down: `None`, `OVER-CURRENT`, `HIGH TEMP (cpu, ...)`, `CPU CLOCK CAPPED`, `GPU CLOCK CAPPED`, or `Prev. over-current (N)` (`photonvision-20`, below) |
| `overCurrentEvents` | integer | soctherm over-current throttle events since boot |
| `heartbeat` | integer | +1 per publish; a stalled value means the telemetry (or PhotonVision) stopped |

- Topics the hardware doesn't have aren't published.
- The JPEG topics need the detector library with `nativeJpegStatus` (rebuild with 07, then
  `08-select-detector.sh bos --mwbd 20`).
- The hardware decoder (`--jpeg nvjpg`) leaked memory inside PhotonVision until it was switched to
  libnvjpeg's MJPEG mode (2026-09-24, see Hardware JPEG decode). While it's off, `jpegDecoder` reads
  `libjpeg-turbo`.
- PhotonVision's own metrics (`/photonvision//metrics/<host>`: CPU temperature and use, RAM,
  disk, uptime) are unchanged.

**Per camera, `/photonvision/<camera>/health/`, every 1 s** (`CameraHealthPublisher`):
- `fps`: pipeline results per second.
- `pipelineMs`, `pipelineMsMax`: average and worst over the last second.
- `latencyMs`: average, capture to result.
- `frames`: total since start.
- `decodeFailures`: total frames our decoder rejected, counted in `USBFrameProvider`. A rising
  count means corrupt JPEGs are getting through.
- The stuck-camera case (see "Decode speedup") shows as `fps` near 0 instead: cscore drops the
  corrupt frames itself, before PhotonVision sees them.

**Per camera, `/photonvision/<camera>/mount/`, every 0.5 s over the last 2 s of multi-tag frames**
(`MountEstimatePublisher`):

| Topics | Meaning |
|---|---|
| `heightM`, `pitchDeg`, `rollDeg` | Means. The camera's pose on the field; with the robot level on the floor, the same as its mount on the robot |
| `heightStdM`, `pitchStdDeg`, `rollStdDeg` | Spread over the window |
| `fieldXM`, `fieldYM`, `fieldYawDeg` | Camera position and heading on the field (yaw is a circular mean), for robot code to combine with its own pose |
| `reprojErrorPx` | Mean multi-tag reprojection error |
| `samples` | Multi-tag frames in the window. 0 means nothing else is updated |

- Angles follow WPILib's `Rotation3d`, like `robotToCamera`: positive pitch points the camera down,
  so a camera tilted up has negative pitch.
- The Targets tab shows the same height, pitch and roll from the UI's 100-sample buffer.
- The robot's origin must be on the floor (WPILib's convention) for the height to match
  `robotToCamera`'s z.

**Settings page** (`photonvision-19`):
- A **GPU Usage** chart under CPU Usage, from the same GPU load file as `gpuLoadPct`.
- It's shown only where the GPU reports its load.
- It's added to the metrics record the UI gets (`gpuUtil`), but not to PhotonVision's
  NetworkTables protobuf. Robot code reads `/photonvision/jetson/gpuLoadPct` instead.
- Checked on the websocket: 10–13% with 2 cameras.

**Throttle reason** (`photonvision-20`, `JetsonThrottle`): the Jetson's version of the Raspberry Pi's
under-voltage and high-temperature flags. It reads only files that don't need root:

| Reason | Source |
|---|---|
| `OVER-CURRENT` | soctherm's over-current event counters (hwmon `soctherm_oc`, `oc1..3_event_cnt`) went up in the last 10 s. The chip throttles when its supply current spikes, e.g. when the robot's battery sags. |
| `Prev. over-current (N)` | N such events since boot, none recently |
| `HIGH TEMP (cpu, gpu, ...)` | a thermal throttle alert is active (`*-throttle-alert` and `hot-surface-alert` cooling devices) |
| `CPU CLOCK CAPPED`, `GPU CLOCK CAPPED` | the thermal framework is holding the clock below its maximum (`cpufreq-cpu*`, `devfreq-17000000.gpu` cooling devices) |

- It fills the Settings page's **CPU Throttling** row and `cpu_thr` in PhotonVision's own
  NetworkTables metrics, via `SystemMonitorJetson`.
- It's also published as `/photonvision/jetson/throttle`.
- Found on the bench: 3 over-current counters, 9 alerts, 2 CPU and 1 GPU clock caps. Reads `None`
  with the fan at full speed; checked on the websocket.

**Bench check:** `tests/jetson-telemetry/run.sh` runs a NetworkTables server on the Jetson and prints
every topic above. Not run yet: the NT topics are published by the running build but haven't been
read back. Set PhotonVision's NT server address to 127.0.0.1 first, and set it back to 8515
afterwards.

### Bad tags, calibration, settings snapshots, copy settings, line-fit knob (2026-09-24)

**`photonvision-22`: tags left out of multi-tag** (`ExcludedTags`). One list for every camera, the
union of two sources:
- the Settings page's AprilTag Field Layout card, saved in
  `photonvision_config/spectrum/excluded-tags.txt` (included in settings exports);
- robot code: `/photonvision/excludedTags` (integer array).

How it behaves:
- Both AprilTag pipelines filter the targets they pass to `MultiTargetPNPPipe`. Excluded tags are
  still reported, with single-tag poses.
- The combined list is published as `/photonvision/excludedTagsActive`.
- REST: `GET/POST /api/excludedTags`, `{"saved": [7, 12]}`.
- **Checked:** save, persist, log, clear, and a 400 for bad input.
- **Not yet checked:** the multi-tag result with tags in view.

**`photonvision-23`: calibration.**
- **Upstream #2437:** 100 snapshots minimum.
- **Auto Snapshots:** a separate toggle, one snapshot request a second; the backend keeps a frame
  only when it finds the board. **Take Snapshot** still works on its own. The idea is from upstream
  #2149, which starts calibrating and loops snapshots behind one button.
- **Board sizes in mm** (upstream #2479; the backend still gets inches).
- **Our board is the default:** ChArUco `Dict_5X5_1000`, 30/22 mm, width 12, height 9.

**`photonvision-24`: settings snapshots for the robot log** (`CameraSettingsPublisher`,
`JetsonSettingsPublisher`). Rebuilt every 5 s and published with `keepDuplicates(false)`, so a value
only goes out when it changes.
- **`/photonvision/<camera>/settingsJson`:**
  - camera, pipeline index, enabled, FPS limit, video mode, quirks
  - the calibration in use: resolution, fx, fy, cx, cy, distortion coefficients, snapshot count,
    lens model
  - `controls`, the raw UVC values: exposure, brightness, contrast, gamma, sharpness, gain, white
    balance, backlight, power-line frequency, autofocus
  - `pipeline`, the full pipeline settings as PhotonVision saves them
- **`/photonvision/jetson/settingsJson`:**
  - PhotonVision version and build date, hostname
  - every `SPECTRUM_*` environment variable, plus the `/tmp` runtime overrides for the JPEG
    decoder and CUDA wait
  - the excluded tags
  - the field layout: tag count, size, and a SHA-256 fingerprint of its tags
  - the uvcvideo `payload_cap`
- **Rewind:** `session.json` gets `settings` from the start of the recording, and `settingsAtEnd`
  if they changed.
- **Checked** in a bench recording's `session.json`:
  - TopRight's calibration: fx 737.0, 41 snapshots, 8 coefficients
  - its controls: contrast 32, gamma 150, sharpness 5, autofocus 0
  - its pipeline: exposure 50

**`photonvision-25`: copy settings** (`VisionModule.copySettingsFrom`,
`POST /api/settings/copySettings`).
- **Groups:**
  - `camera`: exposure, auto exposure, brightness, gain, white balance, stream divisor,
    `blockForFrames`
  - `resolution`: only when both cameras list the same video modes
  - `apriltag`: tag family, decimate, blur, threads, refine edges, iterations, hamming, decision
    margin
  - `output`: 3D, multi-tag, single-tag fallback, drawing, max targets
  - `objectDetection`: confidence, NMS, model
- **How:** fields are copied by reflection, and fields the other pipeline type lacks are skipped.
  If the target pipeline is running, it's re-applied with `setPipeline`, then everything is saved
  and broadcast.
- **UI:** the pipeline menu's **Copy settings from…**, optionally into the same pipeline number on
  every camera.
- **Checked:** TopLeft → TopRight (identical settings) copied 22 fields, and the object-detection
  fields were skipped. Copying a pipeline onto itself, or an unknown group, returns 400.

**Detector `max_line_fit_mse`** (`SPECTRUM_971_MAX_LINE_FIT_MSE`, `08-select-detector.sh --mse N`).
- **Default 10** (AprilTag's), shown in the "971 library loaded" line.
- **What it does:** the GPU line-fit filter rejects a quad if any side's fit error is above it (bos
  `apriltag.cc` → `line_fit_filter.cc`).
- **Upstream #2138** lowers PhotonVision's CPU detector to 2.5, so tags cut off at the image edge
  aren't detected, with little range loss in their tests.
- **Not changed yet:** test it with tags in view first.
- **Deployed build passes** `tests/jpeg-hw/run.sh`.

**`photonvision-26`: tuning guide.**
- **Where:** a collapsible "Tuning guide: what to set, in order" at the top of the Input tab (`TuningGuide.vue`).
- **AprilTag pipelines, in order:**
  1. resolution
  2. auto exposure off
  3. exposure, as short as tags still decode (5 ms), with blur numbers and the 120 Hz flicker rule
  4. brightness 100
  5. decision margin 15
  6. leave the rest
  7. 3D and multi-tag
  8. check on the field, and copy to the other cameras
- **Object Detection pipelines:** a shorter version.
- **Tooltips:** auto exposure, exposure, brightness, gain, low latency, resolution, stream resolution and both decision-margin sliders now lead with the recommended value.
- **Calibration card:** says its long exposure is only for a still board.
- **Blur numbers:** from f ≈ 737 px: 3 rad/s × 5 ms = 0.015 rad ≈ 11 px; 20 ms ≈ 44 px.

### A camera stuck at the wrong resolution (2026-09-24, `photonvision-27`)

**What happened** after a PhotonVision restart at 14:19:
- TopRight streamed 320x240 MJPEG (`v4l2-ctl --get-fmt-video`) while PhotonVision and cscore both
  believed 1280x800.
- At every start, PhotonVision's `setVideoMode` races cscore's connect-time "restoring video mode"
  (logged as "Failed to set video mode!"). Usually the result is still 1280x800; this time it wasn't.
  About 1 in 20 restarts today.
- The direct decode correctly returned "size mismatch" (-3). After 30 in a row it permanently fell
  back to cscore's conversion, which *upscaled* 320x240 to 1280x800.
- Detection kept running at 122 fps, with less range and 1.7 cores instead of 0.5. Found by the
  JPEG-decode session.

**Fix:** `DirectDecode`, one per path, for gray and BGR.
- **A size mismatch never falls back.** The frame is dropped. Once the mismatch lasts 1 s,
  `USBFrameProvider.reconnectForVideoMode` sets the camera's connection strategy to `kForceClose`,
  waits for it to close (up to 1 s), and returns it to `kAutoManage` (PhotonVision's default).
- **Why reconnect:** on reconnect, cscore pushes its `m_mode` to the device ("restoring video
  mode"). Setting the same mode again is a no-op: `UsbCameraImpl::DeviceCmdSetMode` returns when the
  mode is unchanged.
- **Throttled** to every 3 s, and logged as a warning.
- **Real decode failures** (30 in a row) still fall back, but the direct path is retried every 10 s,
  and one failed retry switches straight back.
- **A detector library without the decoder** is never retried.
- **Unit tests:** `DirectDecodeTest` passes 4/4.
- **After deploy:** both cameras at 1280x800, nvjpg 242 frames/s, PhotonVision 0.44 cores.
- **Not yet seen in action:** the race is rare, so watch the log for "reconnecting it so the mode is
  applied again".
- **Health check:** the JPEG session's check now fails any camera whose V4L2 format differs from
  what PhotonVision set.

### Hidden camera controls and stuck-camera recovery (2026-09-24, `photonvision-28`, `-29`)

**`photonvision-28`: contrast, gamma, sharpness, backlight compensation.**
- **Settings:** new `CVPipelineSettings` fields `cameraContrast`, `cameraGamma`, `cameraSharpness`,
  `cameraBacklightCompensation`. -1 means the camera's default.
- **Applying them:** `setPipeline` applies them on every switch; -1 restores the default, so
  pipelines stay independent. They're set in the camera's own units (cscore's `raw_*` properties,
  clamped to the camera's range).
- **UI:** `UICameraConfiguration.extraControls` lists the controls the camera has (key, label,
  min, max, step, default, value). The Input tab shows a slider for each, or a switch for on/off
  ones. They're in the copy-settings Camera group.
- **Thriftiest Cam ranges** (from the camera):
  - contrast 0–95 (default 32)
  - gamma 100–300 (default 150)
  - sharpness 1–10 (default 5)
  - backlight compensation 0–1 (default 1)
- **Checked:** setting `cameraContrast` 40 over the websocket gave `contrast: 40` in `v4l2-ctl`;
  -1 restored 32.

**`photonvision-29`: stuck-camera recovery** (`StuckCameraWatchdog`, in `USBFrameProvider`).
- **Usable frames:** every `getInputMat` result counts, meaning a non-empty image with a capture
  time, from any decode path.
- **Recovery:**
  1. No usable frame for 3 s while the camera is connected: reconnect it (`kForceClose` →
     `kAutoManage`).
  2. Still none 5 s after that: a USB-level reset. The USB device's sysfs `authorized` is set to 0,
     then after 1 s to 1, via `/sys/class/video4linux/videoN/device/..`. It re-enumerates like a
     replug.
  3. After that, a USB reset every 30 s while it stays stuck.
- **Shared throttle:** the patch-27 mode-fix reconnects use the same throttle, so the two never
  reconnect at once.
- **Health:** `/photonvision/<camera>/health/recoveries` counts them.
- **Test hook:** `/tmp/spectrum-camera-stuck-test`, listing camera names, drops those cameras'
  frames. Delete it to end the test.
- **Bench test, TopRight:**

  | Time | What happened |
  |---|---|
  | 14:45:19 | Test started: TopRight's frames dropped |
  | +3.0 s | Reconnect |
  | +8.0 s | USB reset of `1-2.3` |
  | +9.1 s | Kernel re-enumerated it: "Found UVC 1.00 device Thrifty", the payload cap re-applied, "authorized to connect". cscore reconnected |
  | end of test | "delivering frames again, after a USB reset" |

  Afterwards the health check passed: both cameras streaming 1280x800 MJPG as set, NVJPG 242
  frames/s with checks ok, 122 fps each.
- **Unit tests:** `StuckCameraWatchdogTest` 5/5 and `DirectDecodeTest` 4/4.

### Field calibration page (2026-09-24, `photonvision-30`)

A **Field Calibration** page in the web UI (`/#/fieldcal`) for the whole field calibration, done
on the Jetson. The user guide is in the README; how the solver works is in
[tools/fieldcal](../tools/fieldcal/README.md).

- **Backend:** `org.photonvision.fieldcal.FieldCalibration`, a singleton.
  - **Recording** is a Rewind bench recording labelled `fieldcal`. `RewindManager.setManual` now
    takes a label.
  - **Live guidance:** a result consumer on every `VisionModule` (a no-op unless recording).
    - Samples each camera's tag corners every 100 ms.
    - More than 1.5 px of motion, or a completely different set of tags, counts as moving.
    - A spot counts after 1.5 s with no motion from any camera.
    - Per spot, it records which camera saw which tags, and each camera's field position: from
      multi-tag, else the least ambiguous single tag (ambiguity < 0.15).
  - **Solve:** `nice -n 10 python3 -m fieldcal solve` from `/opt/spectrum/fieldcal`, with the
    current PhotonVision layout, the 971 replay (`FIELDCAL_971_DETECT`), and robot code's mounts
    as `--cad`.
    - It inherits PhotonVision's `SPECTRUM_971_*` settings.
    - Output goes to `/opt/photonvision/fieldcal/runs/<recording>/`.
    - "Stop and solve" waits 1.5 s so the recorders finish their files.
  - **Mounts:**
    - read: `/photonvision/<camera>/robotToCamera` (`Transform3d` struct, from robot code);
    - published after a solve: `/photonvision/<camera>/fieldcal/robotToCamera`.
  - **Apply:** saves the layout in use to `/opt/photonvision/fieldcal/layout-backups/`, then loads
    the corrected layout the way an uploaded layout is loaded, and restarts.
  - **Undo:** loads the newest backup and deletes it.
- **Settings tuner:** `CameraSettingsTuner`, run with the robot still, on one camera or on all.
  - **Per camera:** each camera's last results are kept until it's tuned again, and **apply**
    works per camera, so the robot can be turned so each camera faces tags in turn.
  - **Locks:** locked controls are skipped and left as they are. They're stored on the Jetson in
    `/opt/photonvision/fieldcal/locks.json` (`setLock`), so every browser shows the same locks
    and the tuner uses them. A `"locked"` map in the tune request overrides them for that run.
  - **By hand:** `setControl` writes one control into the pipeline in use, applies it and saves,
    as the Input tab does. -1 restores the camera's default for contrast, gamma, sharpness and
    backlight. It's refused while that camera is being tuned.
  - **Preview:** while the page is being polled (within 5 s), every camera's result consumer
    records the tags in view and their decision margins, 4 times a second, for the per-camera
    cards. The page also shows each camera's processed stream.
  - **Checked on the bench:** a manual contrast of 40 reached the camera (`v4l2-ctl`: 40), and -1
    put back the default (32) and the saved pipeline's -1; a locked single-camera tune ran on
    TopLeft alone.
  - **Baseline:** the tags each camera finds in at least 60% of frames over 1.5 s.
  - **Each setting:** 0.4 s to settle, then 0.9 s of frames. It records, for the baseline tags,
    how often each is found, the mean decision margin (`TrackedTarget.getDecisionMargin()`, new)
    and the corner jitter, plus the image's mean brightness.
  - **Order:**
    - exposure: 8 values, 0.18–2x the current; keep the shortest that finds the baseline tags as
      well as the best (within 3%) with at least 85% of the best margin;
    - then gain (if the camera has it), brightness, contrast, gamma, sharpness and backlight
      compensation, each kept only for a 5% better margin;
    - a control with no effect on brightness or margin is reported as such.
  - **End:** the camera goes back to its pipeline's settings. **Apply** writes the
    recommendations into the pipeline in use and saves.
  - **Moving robot:** a tag's centre moving more than 3 px from the baseline stops the sweep.
- **API:**
  - `GET /api/fieldcal`: state, live guidance, tuning, solve log, mounts, recordings, runs.
  - `POST /api/fieldcal {"action": ...}`: start, stop, solve, cancel, tune, cancelTune,
    applyTuning, apply, undo.
  - `GET /api/fieldcal/file?session=&name=`: report.md, results.json, corrected-layout.json,
    mounts.json.
- **3D view** (`FieldCal3D.vue`, three.js already in the UI):
  - **Field:** *FIRST*'s official field CAD by default, converted by `tools/fieldmodel` into
    `assets/field-models/2026-rebuilt.glb` (2.1 MB, meshopt). It's loaded with `GLTFLoader` +
    `MeshoptDecoder` from `fieldmodels/`, which the jar build copies in.
    - `lib/FieldModel.ts` moves each element node (`kind@tags#...`) to its tags in the layout in
      use, and the perimeter's four sides (`@x0`/`@xL`/`@y0`/`@yW`) to the layout's field size.
    - Placed with WPILib's welded layout, every element lands where the build put it (0.001 mm).
    - With AndyMark's layout, the elements move 1.6–3.6 cm and the far walls 2.3 and 2.6 cm.
  - **Fallback:** if the model doesn't load, simplified elements from `lib/FieldElements.ts`,
    sized from the game manual. Each is placed by the tags mounted on it, so the AndyMark and
    welded layouts both work, and after a calibration each element sits where its tags really are:
    - hubs: tags 18–21, 24–27 and 2–5, 8–11;
    - trenches: tags 17/28, 22/23, 1/12 and 6/7, against the guardrail;
    - bumps: between each hub and its trenches;
    - towers: tags 31/32 and 15/16;
    - outposts: tags 29/30 and 13/14.
  - **Mouse:** Onshape's defaults (right-drag turns, middle or Ctrl + right-drag pans, the wheel
    zooms toward the cursor); left-drag also turns. The view can't tilt below the carpet.
- **Install:** `scripts/jetson/13-build-fieldcal-detect.sh --install`.
- **Checked on the bench (no tags in view):**
  - start, live status, stop-and-solve: the replay ran at 560+ fps and reported "nothing to solve";
  - tuning reported "no tags in view" and read the Thriftiest's control ranges;
  - a synthetic 4-camera recording solved through the API;
  - apply then undo: the original layout came back exactly (32 tags, zero difference).
- **Not yet checked:** the page in a browser, the tuner with real tags, and live guidance with
  real tags.

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
