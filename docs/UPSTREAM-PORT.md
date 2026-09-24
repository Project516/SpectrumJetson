# Upstream PhotonVision port (patches 00, 11, 12)

What we brought in from upstream PhotonVision on 2026-09-24, and what to watch for. The port was
done by a Claude subagent in a separate clone (`~/build/pv-upstream`), then built with our real
build script and bench-tested on the Jetson. For the setup itself, see the [README](../README.md).

## The short version

- **`photonvision-00-upstream-v2026.3.4.patch`:** the full diff from the 4143 fork (`d8c9e8e`) to
  a merge of upstream **v2026.3.4**, 41 upstream commits. It still speaks the exact same
  NetworkTables format: all six serde hashes are unchanged (table below), so PhotonLib
  v2027.0.0-alpha-2 on the robot still works.
- **Our 01–10** are regenerated on top of it. Only 05 and 07 changed in content: upstream #2407
  changed how the UI checks for dark mode.
- **`photonvision-11-set-enabled.patch`:** the server side of PhotonLib's
  `PhotonCamera.setEnabled()` (#2484, #2499). It did nothing on our build before.
- **`photonvision-12-opencv-leaks.patch`:** the OpenCV native-memory leak fixes from #2511 that
  matter on our every-frame paths, plus two leaks upstream still has.

### Bench check (2026-09-24)

- All 13 patches applied on the build script's own clone, and the jar built.
- On the Jetson: both cameras at ~121 fps with calibrations loaded, and no "CVMat was GC'd
  without release" warnings.
- Rewind records, and the Settings DB has no pre-2024.3 quirk names (#2412).
- The static gateway is now `10.85.15.4` (#2364, below).

## Serde hashes (the hard constraint)

| Message | before (d8c9e8e) | after (00–12) |
|---|---|---|
| PhotonPipelineResult | 4b2ff16a964b5e2bf04be0c1454d91c4 | same |
| PhotonPipelineMetadata | ac0a45f686457856fb30af77699ea356 | same |
| PhotonTrackedTarget | cc6dbb5c5c1e0fa808108019b20863f1 | same |
| MultiTargetPNPResult | 541096947e9f3ca2d3f425ff7b04aa7b | same |
| PnpResult | ae4d655c0a3104d88df4f5db144c1e86 | same |
| TargetCorner | 16f6ac0dedc8eaccb951f4895d9e18b6 | same |

`photon-serde/` and `photon-targeting/src/generated/` are byte-identical to d8c9e8e.

## Patch 00: upstream v2026.3.4

Highlights among the 41 commits:
- #2356: CVMat refcounting and a leak fix.
- #2364: static-IP gateway `.1` → `.4`.
- #2368: native library hash verification; extracted libraries are re-extracted if corrupt,
  which is good for power cuts.
- #2398: removes the NT reconnect loop.
- #2412: removes the old camera quirk aliases.
- #2429: sets raw exposure before auto exposure.
- #2338: configurable maximum target count.
- #2411: OV2311 auto-exposure quirk.
- Lots of UI, docs and build work.

The merge needed two fixes to build:
- **#2338 renamed `outputShowMultipleTargets` to `outputMaximumTargets`.** 4143's CUDA pipeline and
  `PipelineTypes.ts` still used the old name. Both are fixed, and the CUDA pipeline gets the same
  127-target cap upstream gave the AprilTag pipeline.
- **v2026.3.4 pins dev snapshots of the rknn, rubik and mrcal libraries,** all since deleted from
  maven.photonvision.org. They're pinned back to the releases we already ship; mrcal, the
  calibration backend, is the same binary as before.

## Patch 11: `setEnabled`

- **Topics,** per camera, under `/photonvision/<camera nickname>/`:
  - `enabledRequest` (boolean): the robot writes it with `setEnabled()`. It defaults to `true`.
  - `enabled` (boolean): PhotonVision publishes it with every result.
- **When disabled,** the pipeline is skipped and an empty result goes out. The heartbeat stays at
  0, so **PhotonLib's `isConnected()` goes false after 0.5 s.** That's upstream's behavior: robot
  code that treats `isConnected()` as health will see disabled cameras as disconnected.
- **Where we differ from upstream,** each marked `SpectrumJetson` in the code:
  - A disabled camera also skips the frame grab, which saves our ~3 ms decode.
  - The FPS-limit sleep stays after processing, since upstream's move added up to a frame of
    latency.
  - The thread's interrupt flag is kept.
  - Leaked listeners are removed on camera rename.
- **Rewind keeps recording while a camera is disabled** (it has its own sink). The CUDA detector
  stays allocated, so re-enabling is immediate.
- **Not ported:** the web-UI warning for disabled cameras.

## Patch 12: OpenCV leaks

From #2511, only the fixes on paths that run every frame:
- `TrackedTarget` temporaries, and releasing the targets' native Mats after the output stream has
  drawn them (they were never released).
- `Draw2dTargetsPipe` and `Draw3dTargetsPipe`.
- `TargetCalculations.calculateYawPitch`, and `OpenCVHelp` / `VisionEstimation`.

Plus two that upstream still has:
- the multi-tag first-pass targets in both AprilTag pipelines;
- the frame thrown away on a pipeline switch.

Skipped: the lifecycle refactor, the calibration rework (tangled with 2027 changes) and pipelines
we don't use.

## Upstream changes to test on the robot

- **Gateway (#2364):** static mode now uses `x.x.x.4` as the gateway (10.85.15.4, the VH-109
  radio's address). It doesn't matter on the robot network, which has no internet. In the shop the
  Wi-Fi default route still wins (lower metric).
- **NT reconnect (#2398):** upstream removed its 5-second "restart the NT client" workaround;
  ntcore does the reconnecting now. **Test on the SystemCore:** Jetson booting before the robot,
  robot reboot, and Ethernet unplugged and replugged.
- **Exposure order (#2429):** by the code, manual exposure ends in the same state. Check that
  exposure 50 survives a reboot.
- **Unchanged:** camera matching by USB path, calibration storage, and the settings DB schema.

## Not verified

- A camera the robot had disabled should be disabled again after a Jetson restart (the robot's
  retained `enabledRequest=false` arrives on reconnect). This is reasoned from NT4, not tested.
- The patch-11 unit tests didn't run on the laptop (they need a C++ compiler to build the x86
  JNI, and installing one needs sudo). They run on the Jetson in practice.
- The jar's version string is still `dev-v2026.1.1-27-gd8c9e8e1`: the build script applies
  patches on d8c9e8e, so `git describe` doesn't change. Tell builds apart by sha256.
