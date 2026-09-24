# Jetson + PhotonVision vs. Limelight 4

What this setup (PhotonVision with the CUDA detector, 3–4 Thriftiest Cams) is missing compared
with the Limelight 4s it replaces, and what the robot code has to do about it. For the setup
itself, see the [README](../README.md) and [TECHNICAL.md](TECHNICAL.md).

*Researched September 24, 2026.* Sources:

- the off-season Limelight vision code on `Spectrum3847/2026-Spectrum` branch
  `2026-offseason-bot` (`Vision.java`, `docs/tools/vision.md`, the robot app),
- the `Spectrum3847/2026-FM-SystemCore` branches (`port/fm-2027`, `perf/cleanups`,
  `perf/main-thread-rt`): `PhotonIO`, `PoseFusion`, `docs/pose-sources.md` and the bench CPU
  notes in the README,
- the PhotonLib source at `v2027.0.0-alpha-2`, the version the robot uses,
- the AOS localizer and calibration source (`frc/vision/swerve_localizer/`,
  `calibrate_multi_cameras_lib.cc`),
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

## Questions from AOS

These three questions came up while comparing us with AOS.

### NetworkTables or UDP?

PhotonVision sends results over NetworkTables (NT), which runs on TCP: every message arrives, and
in order. AOS sends its fast data over bare UDP, where a packet arrives or it doesn't:

- the robot sends the Orin its pose and chassis speeds (port 4647),
- the Orin sends back the fused pose (port 4648).

AOS still uses NT for the clock offset and driver station state.

| | NT (PhotonVision today) | UDP (AOS) |
|---|---|---|
| Latency | A little higher. If a TCP packet is lost, everything behind it waits for the resend. | Lowest. A lost packet is just gone, and the next one follows. |
| Logging | Automatic. AdvantageKit and DataLog record it. | Nothing unless we write the logging. |
| Dashboards and debugging | AdvantageScope and Elastic can see it | Custom tools needed |
| Code to write | None; PhotonLib does it | Packet format and parsing on both sides |
| Time sync | PhotonLib runs its own (UDP port 5810) | Uses NT's server time offset |
| On the field | Fine | Fine. Jetson to SystemCore traffic stays on the robot's network. |

**For us, the transport barely matters.** Every PhotonVision result carries its capture
timestamp. The pose estimator applies it at the moment the frame was taken, then replays odometry
forward. A few extra milliseconds in transit only make the correction arrive later; the pose
itself doesn't get worse.

UDP only matters for data flowing the other way at a high rate, such as streaming the gyro to the
Jetson at 200 Hz (what 4533's Whacknet does). **Stay on NT.**

### Is multi-camera extrinsics calibration better?

There are two kinds of calibration.

**Intrinsics** describe the lens itself: focal length, image center and distortion. PhotonVision's
ChArUco board calibration does this. AOS and Limelight do the same thing the same way:

- **Limelight 4** ships factory-calibrated.
- **PhotonVision** needs us to calibrate. Ours are 0.87–0.97 px mean error, which is fine.
- **AOS** is no better here.

**Extrinsics** describe where each camera sits on the robot: x, y, z, roll, pitch and yaw.
**Neither Limelight nor PhotonVision measures this.** We type in CAD numbers. The robot app's
"Measure mount" checks pitch, roll and height, and says outright that it can't measure forward,
right or yaw.

AOS's `calibrate_multi_cameras` (`frc/vision/calibrate_multi_cameras_lib.cc`) **does** measure
extrinsics from data:

1. We hold ChArUco boards where two neighbouring cameras see them at nearly the same moment.
2. It works out each camera's position relative to its neighbour and throws out outliers.
3. It warns if a camera's result varies by more than 3 cm or 3°.

The catch: one "base" camera still takes its mount from CAD. The others are measured relative to
it, so the cameras agree with each other even if the whole set is slightly off.

**This is the calibration that matters most.** A 1° yaw error in a mount moves the pose about
7 cm at 4 m. The 2026 `vision.md` records all three Limelights mounted at about 30° while the code
said 60°. Lens calibration can't catch that; extrinsics calibration can.

**We could build a simpler version with PhotonVision:**

1. Park the robot at a known spot on the field with tags in view.
2. Each camera's multi-tag result gives the camera's field pose, so
   `robotToCamera = fieldToRobot⁻¹ × fieldToCamera`.
3. Average over a few parking spots.

That measures x, y and yaw too, which the robot app can't do today. AOS also has `target_mapper`,
which measures where the tags actually are on a real field, for fields that don't match the
official layout.

### An AOS-style EKF, and where it should run

An EKF (extended Kalman filter) keeps a best-guess pose plus how confident it is in that guess:

- **Between frames**, it drives the pose forward with chassis speeds, and its confidence shrinks.
- **When a tag is seen**, it corrects the pose. How far depends on its confidence and on how
  noisy that measurement is.

AOS's EKF (`frc/vision/swerve_localizer/localizer.cc`) does four things WPILib's
`SwerveDrivePoseEstimator` doesn't:

1. **Each tag is its own measurement.** It uses the heading, distance and skew to that tag instead
   of a finished x/y/θ pose. A single tag measures distance well and sideways position poorly, and
   this shape captures that. WPILib only takes one x/y std dev, so it can't express "sure along
   this line, unsure across it."
2. **It tracks confidence over time.** After a long stretch without tags, it trusts the next tag
   more. WPILib's estimator uses the same fixed weighting every time, which is part of why our code
   needs hand-built tiers.
3. **Noise follows the measurement.** Base noise per tag at 1 m is 0.06 heading, 0.5 distance and
   0.3 skew. Distance and skew noise scale with distance² (capped at 1 m). All noise also scales
   with lens distortion at that tag and with robot speed.
4. **The gyro owns heading.** It rejects a tag whose implied heading disagrees with the gyro (the
   same idea as our turret heading gate). It resets if the filter's heading drifts more than
   0.4 rad from the gyro in teleop, or 1.5 rad in auto.

WPILib's estimator also corrects at the capture time and replays forward. AdvantageKit replay is
the equivalent of AOS's `localizer_replay`, as long as the per-tag data is logged as inputs. AOS is
Apache 2.0, so its `HybridEkf` and corrector math can be ported with credit.

**Where to run it: on the SystemCore, not the Jetson.** AOS runs on the Orin only because the
roboRIO was too slow. That forces the rio to stream speeds and heading over UDP and wait for a
pose to come back. On our robot, the SystemCore wins on every count:

- **The inputs are already there.** CTRE's 250 Hz odometry and the gyro run on the SystemCore. On
  the Jetson we'd have to stream them over the network at 250 Hz, sync clocks, and send the pose
  back: two network hops for data the drivetrain already has.
- **The drivetrain needs the pose on the SystemCore anyway,** for path following and aiming. A
  pose made on the Jetson would be a second copy to keep in step with CTRE's.
- **Replay works.** `PoseFusion` runs on the main loop from logged inputs, so a filter change can
  be replayed against real match logs. A filter on the Jetson sits outside the AdvantageKit log.
- **Failures stay contained.** If the Jetson reboots (about 20 s), a SystemCore filter keeps
  running on odometry and any other enabled sources. A Jetson filter would take the robot's pose
  down with it.
- **The math is cheap.** A 3-state filter works on 3×3 matrices. Even rewinding about 0.2 s of
  250 Hz samples to a frame's capture time is microseconds of work, which the WPILib estimator
  already does.

CPU numbers from `2026-FM-SystemCore`, measured on the bench unit on 2026-09-22 and 23:

| Load | CPU |
|---|---|
| The whole controller | 80–90% busy |
| The SystemCore's own Limelight servers for its two cameras | About 55% of the machine |
| One Phoenix native thread | Spins a full core. Expected to stop with a CANivore attached (not yet confirmed). |
| The robot program's main thread | About 16% of one core |
| `robotPeriodic` at 100 Hz | About 1 ms |

With no cameras on the SystemCore (the competition plan), about half the machine frees up. **The
filter isn't where the CPU goes.** The heavy robot-side item is PhotonLib's constrained solvePnP
(up to about 2 ms per frame on a roboRIO). If that ever gets too heavy, move the **solve** to the
Jetson, Whacknet-style, and keep the **fusion** on the SystemCore. The Jetson isn't idle either: 2
cameras use about 2.8 of its 6 cores, and 4 cameras about 4.5.

**This matches what `2026-FM-SystemCore` already decided.** `docs/pose-sources.md`, carried over
from the `HANDOFF-fm-pose-sources.md` brief, says:

- fusion runs where the drivetrain loop runs (the SystemCore),
- fusion stays WPILib's `SwerveDrivePoseEstimator`,
- "FRC 971's hybrid EKF was evaluated and rejected."

The brief isn't in that repo, so the reason for rejecting the EKF isn't recorded. For October,
keep the WPILib estimator. After the event, the testbed already runs a "shadow" estimator per
source (`PoseFusion`). An EKF could be added the same way as a shadow track, and judged against
the WPILib estimator on real match logs before it ever drives the robot.

## Plan for `2026-FM-SystemCore`

The Orin is already wired into the SystemCore code on the `port/fm-2027` branch and the branches
built on it (not `main` yet). `PhotonIO` reads each camera with `getAllUnreadResults()`. It uses
the Jetson's multi-tag solve when there is one, and otherwise the best single target. Each
camera's results go through the same gates as the Limelights, with its own shadow track.

**Fix before the first robot test:**

- [ ] **Camera names.** `VisionConfig.orinCameraNames` is `{"orin-front", "orin-left",
      "orin-right"}`, but the Jetson names cameras by USB port: `TopLeft`, `TopRight`,
      `BottomLeft`, `BottomRight`. `PhotonCamera` will never connect until these match.
- [ ] **Field layout.** The robot code loads `k2026RebuiltWelded`, and the Jetson is set to 2026
      Rebuilt AndyMark. Multi-tag poses (solved on the Jetson) and single-tag poses (solved on the
      robot) would use different tag positions. Pick the event's field and set both to it.
- [ ] **Mounts.** `VisionConfig.orinRobotToCamera` is still placeholders.

**Next:**

1. **Heading.** Give each camera a `PhotonPoseEstimator` and feed `addHeadingData` every loop,
   ideally from the 250 Hz odometry samples.
2. **MT2-style solves.** Add `estimateConstrainedSolvepnpPose` (`headingFree=false`, seeded from
   the multi-tag pose or the current pose) and `estimatePnpDistanceTrigSolvePose` as extra
   sources. Compare their shadow tracks with the multi-tag one.
3. **Single-tag fallback.** `PhotonIO` uses the best target's `bestCameraToTarget`. Consider
   `estimateLowestAmbiguityPose`, and check how ambiguity gates on real data (sim ambiguity runs
   high, per `pose-sources.md`).
4. **Turret camera.** If a camera goes on a turret, set its `robotToCamera` per frame from the
   turret angle history.
5. **Replacements.** Move LEDs to a CANdle, decide what replaces Rewind, and decide whether the
   robot app's Cameras page gets a PhotonVision backend.
6. **Validate** timestamps and heading lookup on the robot before trusting the tiers.

## Could not confirm

- How long constrained solvePnP takes on the SystemCore.
- Whether the Jetson's USB (UVC) capture path gives start-of-exposure timestamps.
- The LL4's default IMU mode (a forum reply says 0; the docs don't say).
- Whether 971 still runs AOS's localizer in 2026 (evidence points to bos).
- Why the FM handoff rejected 971's EKF (the brief isn't in `2026-FM-SystemCore`).
- Whether the spinning Phoenix thread stops once a CANivore is attached.
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
