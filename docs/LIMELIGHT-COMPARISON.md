# Jetson + PhotonVision vs. Limelight 4

What this setup (PhotonVision with the CUDA detector, 3–4 Thriftiest Cams) is missing compared
with the Limelight 4s it replaces, and what the robot code has to do about it. For the setup
itself, see the [README](../README.md) and [TECHNICAL.md](TECHNICAL.md).

*Researched September 24, 2026.* Sources:

- the off-season Limelight vision code on `Spectrum3847/2026-Spectrum` branch
  `2026-offseason-bot` (`Vision.java`, `docs/tools/vision.md`, the robot app),
- the PhotonLib source at `v2027.0.0-alpha-2`, the version the robot uses,
- the Limelight docs and changelog (LLOS 2026.1),
- the AOS, bos and cos repositories,
- Chief Delphi.

## Short answer

Yes, the robot code needs more work, but less than it sounds. The off-season `Vision.java`
already does the hard robot-side work:

- rejection gates,
- std-dev tiers,
- pose seeding and seed confirmation,
- gross and consensus heading checks,
- composing the turret camera's pose.

Underneath all that, the Limelights supply three things:

1. **The MT1 solve.** PhotonVision's multi-tag solve on the Jetson replaces it.
2. **The MT2 solve.** It moves into PhotonLib on the SystemCore.
3. **Camera-side extras:** the tag ID filter, pushing the mount pose, LEDs, Rewind, and the REST
   API the robot app uses. PhotonLib handles some of these on the robot for free. The rest are
   lost and need replacing.

**The LL4's built-in IMU isn't doing anything for our pose.** The chassis cameras run
`imumode 1` (EXTERNAL_SEED). In that mode the internal IMU is just kept matched to our gyro, and
MT2 still uses the gyro yaw we push. The turret camera runs mode 0, which ignores the internal
IMU. Losing it only costs the robot app's accelerometer pitch check.

## MegaTag 1 and 2 in PhotonLib

PhotonLib 2027-alpha-2 removed the old `update()` / `PoseStrategy` API. Each strategy is now its
own method on `PhotonPoseEstimator`, and the only constructor is
`(AprilTagFieldLayout, robotToCamera)`.

| Our code uses | Limelight | PhotonLib equivalent |
|---|---|---|
| MT1: seeding, gross and consensus heading, turret composition | `botpose_wpiblue` | `estimateCoprocMultiTagPose`, falling back to `estimateLowestAmbiguityPose` for a single tag. Multi-tag must be turned on per camera in the PhotonVision UI. |
| MT2: chassis translation once the seed is confirmed | `botpose_orb` + `SetRobotOrientation` | `estimateConstrainedSolvepnpPose` (all tags, heading held to the gyro) or `estimatePnpDistanceTrigSolvePose` (best single tag only). Both need `addHeadingData` every loop. |
| Per-tag ambiguity | `rawfiducials` | `target.getPoseAmbiguity()` |
| `ta` target size | `ta` | Sum of `target.getArea()` over the targets |
| Std devs | `stddevs` (not used) | PhotonVision publishes none. Keep our tiers. |

### What gets better

- **Heading at the frame's timestamp.** `addHeadingData` fills a 1 s `TimeInterpolatableBuffer`,
  and both heading-based solvers look up the gyro heading at the frame's capture time. Our
  `vision.md` notes that the Limelight tags MT2 with whatever heading was pushed last, which is why
  the 0.3 s yaw-rate lookback gate exists. That latency error goes away. Keep a looser gate for
  motion blur.
- **The camera mount lives in robot code** (`setRobotToCameraTransform`). We no longer need
  `sendCameraSettings()` to resend it every couple of seconds, and the yaw-sign quirk goes away.
- **The turret camera gets MT2.** Before each estimate, set the transform from
  `Turret.getAngleAt(result timestamp)`. That gives a heading-held solve for the turret camera,
  which the default Limelight mode couldn't do (it fused a composed MT1 translation).
- **Every frame, not just the latest.** `getAllUnreadResults()` returns about 2 frames per camera
  per 20 ms loop at 90 fps.
- **No NetworkTables flush dependency** for pushing heading.
- **Simulation.** PhotonLib's `VisionSystemSim` can simulate the cameras alongside maple-sim.

### Gotchas

1. **SystemCore CPU.** Constrained solvePnP runs on the robot and is documented at "typically not
   more than 2 ms" on a roboRIO. Four cameras at about 2 frames each is about 8 solves per loop.
   Run it on the newest frame per camera only (or use trig solve), and time it on the SystemCore.
2. **Missing heading throws.** In alpha-2, `estimateConstrainedSolvepnpPose` calls
   `headingBuffer.getSample(...).get()` without checking for a value. It throws if no heading has
   been added yet, even with `headingFree=true`. Add heading data before the first estimate.
3. **Calibration from the camera.** The constrained solve needs `camera.getCameraMatrix()` and
   `camera.getDistCoeffs()`. The distortion is 8 coefficients (`N8`), which matches our
   8-coefficient fix. Both return empty until the camera has connected.
4. **Trig solve uses one tag.** It uses only the best target, even when several are visible.
5. **Different timestamps.**
   - PhotonLib runs its own time sync over UDP 5810 and stamps frames at the start of exposure.
   - Limelight stamps mid-exposure: the NT server time minus `cl + tl`.
   - At exposure 83 (8.3 ms), that's a bias of about 4 ms.
   - Check that PhotonLib timestamps are in the timebase `Utils.fpgaToCurrentTime` expects on the
     SystemCore. Then spin the robot in place in front of a tag and look for pose smear.
6. **No tag ID filter.** PhotonVision's multi-tag solve uses every tag in the layout uploaded to
   the Jetson. Our `SetFiducialIDFiltersOverride` passes every official ID, so this costs little;
   filter single-tag results in robot code.
7. **Field layout.** The Jetson is set to 2026 Rebuilt AndyMark. The robot code's layout must match
   it, and both must match the event's field.
8. **Retune the tiers.** PhotonVision computes ambiguity and area differently, so the 0.9
   ambiguity and `ta` thresholds won't carry over as-is.

## Other features we lose

| Feature | Used in our code? | With PhotonVision + Jetson |
|---|---|---|
| Rewind (`triggerRewindCaptureForAllCameras`) | Yes, from `Robot` | Nothing equivalent; PhotonVision only has snapshots (`takeInputSnapshot`). We could record the MJPEG streams to the NVMe. They're already compressed, so recording is cheap. |
| LEDs (`blinkLimelights`, `solidLimelight`) | Yes | Thriftiest Cams have no LEDs. Move driver signals to a CANdle. |
| Robot app Cameras page: auto-tune exposure, measure and write back the mount, accelerometer pitch | Yes | All of it calls the Limelight REST API (`/status`, `/results`, `/hwreport`, `/update-pipeline`). It needs a PhotonVision backend. The tag-solve mount measurement can be rebuilt; the accelerometer check can't. |
| Camera temperature and fps in the robot log | Via the robot app | Only `scripts/jetson/health-check.sh` over SSH. Worth publishing to the robot log. |
| Hailo neural detection, SnapScripts, crop, throttle | No | PhotonVision has no object detection on Jetson. bos has TensorRT YOLO if we want game-piece detection later. |
| Independent cameras | Implicitly | One Jetson, one Ethernet link and one shared USB hub now carry every camera. The Jetson needs a solid regulated supply. A reboot costs about 20 s before the first detection. |

The Limelight doesn't fuse cameras together either, so we lose nothing there.

## AOS, BOS and other forks

We run the 971 detector inside PhotonVision rather than one of these full systems. Here's what
each one would add:

| System | Heading-constrained pose | Fuses cameras on the coprocessor | Full state estimator | Sensor-accurate timestamps | Notes |
|---|---|---|---|---|---|
| [AOS](https://github.com/RealtimeRoboticsGroup/aos) (1868, 4646) | Yes, rio heading in the EKF | Yes, 4 cameras in one EKF | Yes: x, y, θ, fed chassis speeds | Yes (Argus sensor timestamps; V4L2 monotonic minus ISP latency) | UDP link to the rio, multi-camera extrinsics calibration, log replay. Needs Bazel and replaces our robot-side localization. |
| [bos](https://github.com/frc971/bos) (971, 2026) | No | Yes: picks the most consistent solution across cameras | No | No: host read time | Also VPI detector, TensorRT YOLO, on-Orin pathing |
| [cos](https://github.com/frc971/cos) | No | Yes | No | No: libuvc host time | Node-graph rewrite of bos |
| [4143 PhotonVision fork](https://github.com/FRC-Team-4143/photonvision) (ours) | Only through PhotonLib on the robot | No | No | PhotonVision standard | Stock PhotonVision after detection |
| [4533 Whacknet](https://www.chiefdelphi.com/t/4533-phoenix-whacknet-off-rio-constrained-solve-for-apriltags-zero-allocation-udp-vision/518777) | Yes, on the coprocessor | Several cameras (fusion not confirmed) | No | Gyro interpolated to shutter time | PhotonVision fork. The rio streams the gyro at 200 Hz over UDP. |
| Limelight 4 | Yes (MT2) | No | No | Yes | Built-in IMU |

- **AOS** is the only one that goes beyond MegaTag2. Adopting it means replacing our robot-side
  localization.
- **Whacknet** is our upgrade path if the constrained solve turns out too heavy for the
  SystemCore.

## Plan for `2026-FM-SystemCore`

1. **Estimators.** Create one `PhotonCamera` and one `PhotonPoseEstimator` per camera. Feed
   `addHeadingData` every loop, ideally from the 250 Hz odometry-thread samples.
2. **Per result from `getAllUnreadResults()`:**
   - MT1 is `estimateCoprocMultiTagPose`, falling back to `estimateLowestAmbiguityPose`.
   - MT2 is `estimateConstrainedSolvepnpPose` with `headingFree=false`, seeded from MT1 or the
     current pose, falling back to `estimatePnpDistanceTrigSolvePose` for a single tag.
3. **Port the logic** from the off-season `Vision.java`: gates, tiers, seeding and confirmation,
   and heading checks. Retune the thresholds.
4. **Turret camera.** Set a per-frame `robotToCamera` from the turret angle history.
5. **Replacements.** Move LEDs to a CANdle, decide what replaces Rewind, and decide whether the
   robot app's Cameras page gets a PhotonVision backend.
6. **Validate** timestamps and heading lookup on the robot before trusting the new tiers.

## Could not confirm

- How long constrained solvePnP takes on the SystemCore.
- Whether the Jetson's USB (UVC) capture path gives start-of-exposure timestamps.
- The LL4's default IMU mode (a forum reply says 0; the docs don't say).
- Whether 971 still runs AOS's localizer in 2026 (evidence points to bos).
- Any head-to-head accuracy data comparing MT2 with PhotonLib's trig or constrained solve.

## References

- [PhotonLib pose estimator docs](https://docs.photonvision.org/en/latest/docs/programming/photonlib/robot-pose-estimator.html)
- [`PhotonPoseEstimator` at v2027.0.0-alpha-2](https://github.com/PhotonVision/photonvision/blob/v2027.0.0-alpha-2/photon-lib/src/main/java/org/photonvision/PhotonPoseEstimator.java)
- [PhotonVision time sync](https://docs.photonvision.org/en/latest/docs/contributing/design-descriptions/time-sync.html)
  and [end-to-end latency](https://docs.photonvision.org/en/latest/docs/contributing/design-descriptions/e2e-latency.html)
- [Limelight MegaTag2 and IMU modes](https://docs.limelightvision.io/docs/docs-limelight/pipeline-apriltag/apriltag-robot-localization-megatag2)
- [Limelight NetworkTables API](https://docs.limelightvision.io/docs/docs-limelight/apis/complete-networktables-api)
- [Limelight changelog](https://docs.limelightvision.io/docs/docs-limelight/software-change-log)
- [CUDA AprilTag detection with PhotonVision (Chief Delphi)](https://www.chiefdelphi.com/t/cuda-apriltag-detection-with-photonvision/483803)
