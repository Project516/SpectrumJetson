# Field calibration mode (plan)

Agreed 2026-09-24. **Built:**
- **A page in PhotonVision** (`photonvision-30`, Field Calibration in the sidebar) runs the whole
  thing on the Jetson. It has the settings sweep ("Tune camera settings"), the guided recording,
  the solve, the results, and applying the layout.
- **The solver** is [tools/fieldcal](../tools/fieldcal/README.md). It replays the recording
  through the 971 GPU detector PhotonVision uses.
- **Camera mounts come from robot code** over NetworkTables (`/photonvision/<camera>/robotToCamera`).

Tested on synthetic data, including rendered recordings, and through PhotonVision's API on the
bench. Next: a shop test on our half field.

During an event's field calibration time, with the robot
pushed around **by hand** (it can't be driven then), measure three things from the robot's own
cameras:
- the real positions of the event field's tags
- every camera's mount (`robotToCamera`)
- the best camera settings under the event's lights

Status and other ideas are in [VISION-RESEARCH.md](VISION-RESEARCH.md#future-work).

## Why it works

- **One solve for everything.** At each spot where the robot sits still, every camera records the
  tag corners it sees. One least-squares solve (bundle adjustment) then fits all the unknowns:
  - each tag's pose
  - each spot's robot pose
  - each camera's mount
- **The rigid camera rig links tags.** The mounts don't change, so tags seen by *different*
  cameras from the same spot are tied together, even when no single camera sees both.
- **Scale** comes from the printed tag size, and many spots average out the noise.
- **Other teams do parts of this:** 971 (target mapper, camera calibration from logs) and WPIcal
  (field map only, from phone video).
- **Moving by hand helps:** the robot is completely still for each capture, so there's no motion
  blur and no timing error between cameras (they aren't frame-synchronized).

## What vision alone can't tell, and how we pin it down

| Unknown | Fix |
|---|---|
| Where the whole map sits on the field (it can slide or rotate as a whole) | Best-fit the solved map to the official layout, as 971 does. The result reads as "tag 7 is 2.1 cm left and 0.8° off". |
| Where the robot is inside the camera rig (vision gives the cameras only relative to each other) | Height, pitch and roll come from the robot sitting level on the carpet. For x, y and yaw: **a reference spot**, the robot pushed flush into something whose position is known (a field corner, or a marked spot on the alliance wall), plus the bumper dimensions. Or take x/y/yaw from CAD: machined mounts are usually good to a few mm and under 1°, and the camera-to-camera geometry checks them. |
| Tags nobody saw well | Each tag must be seen from 2+ spots, at different angles and distances. |

- **The gyro still helps.** Robot code runs while disabled, so the log records how far the robot
  turned between spots.
- **Wheel odometry doesn't:** pushed wheels skid and the swerve modules swivel freely.
- **Pitch, roll and height matter most.** A 1° pitch error puts a tag 4 m away off by about 7 cm.
  They're also what CAD gets wrong.

## Procedure at the event

Robot on and disabled, 2 people, about 10 minutes.
1. Start recording from a dashboard button. Rewind's `record` topic works while disabled; label it
   e.g. `fieldcal`.
2. Push the robot into the reference spot and hold 3 s.
3. Visit 10–20 spots spread over the field, **flat carpet only** (not the bumps). Turn the robot by
   hand at some of them so each camera sees tags from several angles and distances. Hold 2–3 s at
   each spot.
4. Keep people out of the cameras' views during the holds.
5. Finish back at the reference spot (a check for mistakes), then stop recording.
6. **Optional:** a settings sweep at one spot, under the event lights. The Jetson steps through the
   camera settings itself in 1–2 minutes while the robot sits still (below).

No button is needed at each spot: record continuously, and the solver finds the still stretches
itself (camera poses and gyro not changing).

## Settings sweep

**What the Thriftiest Cam exposes:**
- **In PhotonVision's UI:** exposure, auto exposure, brightness, white balance.
- **Not in the UI:** contrast (0–95, default 32), gamma (100–300, 150), sharpness (1–10, 5),
  backlight compensation (on).
- **Gain:** not reported by our cameras' firmware. The UI shows a slider since `photonvision-21`;
  test whether it does anything.
- **Doesn't matter on a mono camera:** saturation and hue.
- UVC cameras don't save settings, so whatever we choose has to be applied on every connect. The
  hidden controls need a small patch adding them to the Input tab.

**Measured for each setting:**
- decision margin
- whether the farthest tag is still found
- corner jitter while the robot is still
- JPEG size (USB bandwidth under the alt-7 cap)
- brightness pulsing under the lights (the flicker check)

**Recommendations it would give:**
- **Exposure:** the shortest one that keeps far tags reliable.
- **Contrast and gamma:** the best decision margin.
- **Sharpness:** worth testing. The camera's sharpening can put halos on edges, which could shift
  corners, and it makes JPEGs bigger.
- **Decision-margin cutoff:** from the lowest margins of real detections.

## Outputs (laptop solver, a few minutes)

- A corrected field layout JSON, for both robot code and PhotonVision.
- `robotToCamera` for every camera.
- **A report:**
  - each tag's offset from the official layout
  - fit error per tag and per camera
  - a noise factor per camera, for the robot's std devs (Northstar's `cameraFactor`)
  - tags to distrust
  - whether a camera needs recalibrating (fit errors growing toward the image edges)
  - the recommended settings

## Inputs (mostly exist already)

- **Rewind recording** of every camera, labelled `fieldcal`. 30 fps is plenty for still stretches.
- **The robot's AdvantageKit log,** for the gyro.
- **Each camera's lens calibration** (PhotonVision's calibration JSON).
- **Tag corners:** re-detected offline from the recorded frames with a CPU AprilTag detector, or
  taken from logged PhotonLib results.

## Shop test first

On our half field (most of half a field's tags), before an event. About 30 min, 2 people.

1. **Before:** build the replay tool on the Jetson once (`scripts/jetson/13-build-fieldcal-detect.sh`).
   Write `cad.json` from robot code's `robotToCamera` for every camera (format in
   [tools/fieldcal](../tools/fieldcal/README.md)). Pick the layout that matches how our field
   elements are built.
2. **Tape-measure 3–4 tags** from a wall or field corner: centre height, and distance along and out
   from the wall. That's the only ground truth.
3. **Record:** robot on and disabled, Settings → Rewind → **Record now**. Push the robot to ~15
   spots on flat carpet, hold each 3 s, turn it at some so every camera sees tags from several
   angles and distances. Keep people out of the views during holds. Stop.
4. **Do it again** (a second recording, different spots).
5. **Solve both on the Jetson** (`fieldcal.sh solve ... --cad cad.json`), then compare:
   - **Repeatability:** `fieldcal.sh compare ~/fieldcal/<first> ~/fieldcal/<second>`. The two
     runs should agree to ~1 cm on tags and a few tenths of a degree on mounts. More than that
     means a spot problem (bumps, the robot rocking) or a lens calibration problem.
   - **The tape-measured tags** against the report.
   - **The mounts** against CAD (the report's "Against CAD" table) and against the live mount
     estimate (`photonvision-17`).
   - **The lens check** in the report: fit errors growing toward the image edges mean recalibrate.

**Expected accuracy:** about 1 cm and a few tenths of a degree. On synthetic data the solver does
better (a few mm, 0.03°), so the real limits will be the lens calibration and the floor.

## Open questions

- **Field access:** confirm the event's field calibration rules allow the robot on, powered and
  disabled.
- **Reference spot:** pick one per game. It depends on the field elements; the 2026 field has
  bumps.
- **Tag corners:** offline CPU detector or logged corners? Logged corners come from the Jetson's
  own 971 detector, so they match what the robot uses.
- **Solver library:** scipy least_squares is enough for ~30 tags, 20 spots and 4 cameras. Ceres or
  GTSAM if it gets bigger.
