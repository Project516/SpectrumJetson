# Vision research: other systems, and what we changed

What other FRC vision systems do that ours doesn't, what we measured on our own Jetson, what we
changed, and what's worth doing next. Researched and measured 2026-09-24. For the setup itself see
the [README](../README.md) and [TECHNICAL.md](TECHNICAL.md).

## Results first: where our CPU was going, and the fix

Profiling PhotonVision found that each camera's thread spent most of its time decoding the
camera's MJPEG frames, and that the decode was far more expensive than it needed to be:

- **cscore decoded every frame to full colour, then converted it to gray.** WPILib's cscore
  (2026.2.1, `Frame::ConvertImpl`) decodes any MJPEG frame to BGR first, even when the sink asks
  for grayscale. Its grayscale-only decoder (`ConvertMJPEGToGray`) exists but is never called.
  Measured on the Jetson from recorded frames: **8.9 ms per 1280x800 frame** that way, against
  **2.6 ms** decoding straight to gray with libjpeg-turbo. At 100+ fps that difference was most
  of a CPU core per camera, and it sat on every frame's latency path.
- **OpenCV's worker pool spun between jobs.** The colour-to-gray conversion ran on OpenCV's
  thread pool, whose workers busy-wait for their next job by default: 5 threads at ~22% each.
- **Our patch 02** ("gray capture") asked cscore for grayscale, which skipped a Java-side
  conversion but not cscore's colour decode, so the big cost stayed hidden until now.

Fixes:

1. `patches/photonvision-09-direct-gray-decode.patch` plus `decodeMjpegGray` in
   `detector/GpuDetectorJNI.cc`: PhotonVision takes the camera's own JPEG from cscore (as Rewind
   does) and our detector library decodes it straight to gray with libjpeg-turbo, into an image
   PhotonVision allocated.
   - A corrupt JPEG returns an error instead of crashing the JVM (libjpeg's default is `exit()`).
   - After 30 failures in a row, that camera falls back to cscore's conversion.
2. `09-robot-tuning.sh` step 9: `OPENCV_THREAD_POOL_ACTIVE_WAIT_WORKER=0` and `..._MAIN=0` for
   PhotonVision, so OpenCV's workers sleep instead of spinning. The pool is kept.

| 2 cameras, 1280x800, bench | TopLeft | TopRight | PhotonVision CPU (of 600%) | Latency (UI) |
|---|---|---|---|---|
| Before | 92 fps, 2.4 ms detect | 104 fps, 1.9 ms | 333% | ~23 ms |
| After | **122 fps**, 1.6 ms | **122 fps**, 1.6 ms | **129%** | **13 ms** |

Both cameras now run at their full 120 fps. CPU per frame went from about 17 ms to 5 ms, which is
what makes 4 cameras realistic. (Measured with `tests/perf-snapshot.sh`, which also reports
browser stream viewers, because a preview stream costs CPU.)

**Also tried and not kept: letting the CPU sleep while the GPU works.** The 971 detector waits on
the GPU ~8 times a frame, and CUDA's default wait busy-spins the CPU. Switching it
(`cudaDeviceScheduleBlockingSync`) saved no CPU and added ~0.3 ms of detect time; `yield` was no
better. The default stays CUDA's own, and the setting remains switchable for the 4-camera test
(`SPECTRUM_971_CUDA_SYNC`, or `/tmp/spectrum-971-cuda-sync` + restart).

### Exposure: 5 ms

The team found exposure **50 = 5 ms** works with the decision-margin cutoff lowered to **15**.
Shorter exposure means less motion blur, and tag36h11 with Hamming distance 0 almost never gives
false positives. The trade-off is flicker: under 120 Hz lights, an exposure that isn't a multiple
of 8.33 ms makes each frame catch a different part of the flicker cycle.
`tests/flicker-check/run.sh` measured **no flicker in the shop** at 5 ms: brightness changed 0.6%
frame to frame on average, 1% at most. **Rerun it under the event's lights.**

- New cameras now start with exposure 50 and decision margin 15 (`patches/photonvision-10-...`).
- The exposure slider now shows milliseconds for USB cameras. The raw number is in the UVC
  standard's 100 µs units, which is how 295 once looked reasonable but meant 29.5 ms and capped
  the frame rate.

## Other systems we looked at

### EagleEye (ElliotScully / Scythe-Engineering)

[Repo](https://github.com/Scythe-Engineering/EagleEye-Vision-System),
[Chief Delphi thread](https://www.chiefdelphi.com/t/eagleeye-photonvision-alternative-with-120-apriltag-fps-on-raspi-5/523976).
Python + Rust, Raspberry Pi 5. **PolyForm Noncommercial license: we can take ideas, not code.**
One author, alpha, not reported on a competition robot.

- **Main trick: region tracking.** It projects the field's tags through the last camera pose,
  warps each predicted region to a square crop, and runs the CPU detector only there, falling back
  to a full frame only when it finds zero tags. On *synthetic* frames it measured 5.9 ms against
  PhotonVision's 18–44 ms, excluding JPEG decode.
- **Why it doesn't help us:** our GPU detector does a full frame in ~1.6 ms, so there's almost
  nothing left to save. It also has recovery risks: a wrong pose after a collision searches the
  wrong places, and one lucky tag suppresses the full-frame fallback.
- **The one relevant idea was grayscale-only JPEG decode.** That turned out to be exactly our
  problem (above).

### Code Orange (3476): "MLTag"

[PR #2410](https://github.com/PhotonVision/photonvision/pull/2410), replaced by
[#2604](https://github.com/PhotonVision/photonvision/pull/2604), both open and targeted at
PhotonVision 2027.

- **It's not game-piece detection.** A YOLO model on an NPU (Rubik Pi / Orange Pi) finds the tags,
  and the CPU AprilTag detector reads only those crops, resizing big close tags down to ~200 px.
- **Their numbers:** about 2x on their 2026 robot, 50–60+ fps at 1280x800.
- **Same reason as EagleEye: little gain for us,** because we already detect on the GPU.

### Game-piece detection on the Jetson (if we want it later)

- **[frc971/bos](https://github.com/frc971/bos)** has TensorRT YOLO (`src/yolo/yolo.cc`) and a
  **grayscale** model (`gray.engine`, 2025 game pieces). It projects detections to the floor and
  publishes `Pose2d`. It has no license file, so ask 971 before copying.
- **Grayscale matters:** our cameras are mono, so models must be trained on gray images of our
  own camera's frames.
- **No DLA on the Orin Nano,** so YOLO shares the GPU with AprilTags. Ultralytics' numbers for
  YOLO26n at 640 on an Orin Nano Super are 3.8–4.6 ms (INT8/FP16), plus pre/post-processing.
  One camera at 30 fps is realistic; all four at 120 fps is not.
- **Most practical path:** a separate TensorRT process on its own camera, publishing to
  NetworkTables. A TensorRT backend inside PhotonVision is the nicer end state and a lot more
  work.

### PhotonVision forks and upstream

- **Wire compatibility is better than we thought.**
  - The serde hashes changed with upstream [#2566](https://github.com/PhotonVision/photonvision/pull/2566)
    (WPILib alpha-7: timestamps became nanoseconds).
  - The last compatible upstream main commit is **a9ad078b**, already on WPILib 2027 alpha-6.
  - **Upstream v2026.3.4** is also still compatible (hash 4b2ff16a), and it merged with no
    conflicts onto the 4143 fork in a trial (our own patches not included in that test).
- **4533 "Whacknet"** ([fork](https://github.com/4533-phoenix/photonvision),
  [thread](https://www.chiefdelphi.com/t/4533-phoenix-whacknet-off-rio-constrained-solve-for-apriltags-zero-allocation-udp-vision/518777))
  solves the heading-constrained pose on the coprocessor, with the robot streaming its gyro over
  UDP at 200 Hz.
  - Porting it means leaving out its `messages.yaml` change, which would break the wire format.
  - Its `speedup` branch only reconfigures the detector when settings change; that part is cheap
    to take.
- **frc971 cos** decodes MJPEG with the Jetson's hardware JPEG decoder (`NvJPEGDecoder`). Not
  needed now that CPU decode is 2.6 ms, but it's the reference if we ever are.
- **STEM-Alliance and joelamaldas forks** duplicate what we already have, including recording.
- **PhotonLib alpha-2 already has `PhotonCamera.setEnabled()`**
  ([#2484](https://github.com/PhotonVision/photonvision/pull/2484)), but our 2026-based
  PhotonVision ignores it. Porting the server side (#2484/#2499) is small and safe.
- **Other upstream fixes worth taking:**
  - OpenCV native-leak sweep [#2511](https://github.com/PhotonVision/photonvision/pull/2511)
    (conflicts; hand-port)
  - CVMat refcount fix [#2356](https://github.com/PhotonVision/photonvision/pull/2356)
  - NT reconnect-hack removal [#2398](https://github.com/PhotonVision/photonvision/pull/2398)
  - calibration minimums [#2437](https://github.com/PhotonVision/photonvision/pull/2437) /
    [#2438](https://github.com/PhotonVision/photonvision/pull/2438)
  - ThriftiestOV9281 support [#2478](https://github.com/PhotonVision/photonvision/pull/2478)
- **Robot code:** avoid PhotonLib's heading-free constrained solve with an empty heading buffer
  ([#2529](https://github.com/PhotonVision/photonvision/pull/2529); alpha-2 throws).

### Jetson-specific findings

- **4 cameras on the USB-A ports will likely fail.** All four ports share one USB 2.0 hub, and a
  UVC camera *reserves* isochronous bandwidth for its maximum, not what it uses. So a third or
  fourth camera is likely to fail with "No space left on device".
  - The devkit's USB-C port is a separate root port
    ([NVIDIA forum](https://forums.developer.nvidia.com/t/usb-2-0-instead-of-usb3-2-on-jetson-orin-nano-super-dev-kit/357813)).
    Plan 2 cameras on USB-A and 2 on USB-C, through an adapter or hub.
  - USB-C is also our laptop cable today; on the robot we'd use Ethernet instead.
  - **Test this before the 4-camera build.**
- **Hardware JPEG decode (NVJPG) exists on the Orin Nano,** but the forums report clock and
  chroma-format bugs and a symbol clash with OpenCV. Not worth it now that CPU decode is cheap.
- **CSI cameras:** the devkit has 2 connectors; Arducam's OV9281 does 80 fps at 1280x800 (slower
  than our USB 120 fps). No JPEG step, and hardware timestamps. A next-season option.
- **Lower-jitter options (971's approach):** pin USB interrupts to one core, run the capture
  threads at real-time priority, and disable the deepest CPU idle state. This helps worst-case
  latency, not the average. Low effort.
- **Doesn't apply to us:** VPI/PVA AprilTags (the Orin Nano has no PVA), region tracking,
  uncompressed USB 2 video, and Java GC tuning (our heap sees no collections).

## What to do next

Before October:

1. **Test 3 and 4 cameras with the USB split** (2 on USB-A, 2 on USB-C). Re-measure CPU, fps
   and latency with `tests/perf-snapshot.sh`. Re-check the CUDA wait setting there.
2. **Rerun `tests/flicker-check`** under the event field's lights before settling on 5 ms.
3. **Port the server side of `setEnabled`** (#2484/#2499), so robot code can turn cameras on and
   off. Small.

Worth doing, not urgent:

4. Merge upstream **v2026.3.4** into our fork base: 41 fixes, still wire-compatible, and a clean
   trial merge onto 4143 main. Then re-apply and re-test our patches.
5. Hand-port the OpenCV **leak fixes** (#2511) for long-running stability.
6. **IRQ affinity and real-time priority** for capture, if we ever see latency spikes.

Next season:

7. Consider basing on **upstream PhotonVision main** (a9ad078b is 2027-alpha-6 and
   wire-compatible) with our CUDA pipeline ported, instead of the 2026-based 4143 fork.
8. **Coprocessor constrained solve** like Whacknet, if the SystemCore's constrained solve is too
   slow (robot side first; see issue #10).
9. **Game-piece detection:** a TensorRT YOLO on its own camera, starting from bos's `yolo.cc`,
   with a model trained on our cameras' gray frames.
