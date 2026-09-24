# fieldcal: field calibration from a Rewind recording

Push the robot by hand to 10–20 spots on the field, hold it still for 2–3 s at each, and record
every camera with Rewind. This tool then works out, all in one solve:

- **where the field's tags really are** (a corrected layout JSON for PhotonVision and robot code),
- **every camera's mount** (`robotToCamera`: height, pitch and roll from the floor; x, y and yaw
  from an anchor),
- **how each camera's lens calibration and noise hold up.**

The why and the procedure at an event are in
[docs/FIELD-CALIBRATION-PLAN.md](../../docs/FIELD-CALIBRATION-PLAN.md).

**Status (2026-09-24):** tested on synthetic data only, including whole rendered recordings.
Next: a shop test on our half field.

## Setup (laptop, once)

Python 3.10 or newer.

```bash
python3 -m venv ~/build/fieldcal-venv
```

```bash
~/build/fieldcal-venv/bin/pip install -r tools/fieldcal/requirements.txt
```

On Ubuntu, `python3 -m venv` needs `sudo apt install python3-venv` first. `fieldcal.sh` uses
`~/build/fieldcal-venv`; set `FIELDCAL_PYTHON` for another Python. On Windows, run
`python -m fieldcal ...` from `tools/fieldcal` instead of `fieldcal.sh`.

## Use

1. **Record.** Robot on and disabled. Set Rewind's `label` to `fieldcal`, then `record` true (or
   Settings → Rewind → Record now). Push the robot to each spot and hold it still 2–3 s; turn it by
   hand at some spots so every camera sees tags from several angles. Stop recording.
2. **Copy it to the laptop.** `scripts/host/rewind-pull.sh <name>` (lands in `~/rewind/<name>/`),
   or the browser download (Settings → Rewind), unzipped. Both work.
3. **Solve:**

   ```bash
   tools/fieldcal/fieldcal.sh solve ~/rewind/<name> --layout tools/fieldcal/layouts/2026-rebuilt-andymark.json --cad cad.json
   ```

4. **Read `<recording>/fieldcal/report.md`,** then use `corrected-layout.json` and the mounts.

No button is pressed at each spot: the tool finds the still stretches itself (no camera's tag
corners moving). Tag detection runs on every CPU core at about 5 frames per second of recording and
is cached in `detections.json`, so re-solving with other options takes seconds.

### Options that matter

| Option | What for |
|---|---|
| `--layout` | The official layout the field should match. Use the one for the field you're on (AndyMark or welded). |
| `--cad cad.json` | Each camera's `robotToCamera` from CAD or robot code: `{"TopLeft": {"x": 0.26, "y": 0.26, "z": 0.45, "rollDeg": 0, "pitchDeg": -15, "yawDeg": 30}, ...}`. Anchors x, y and yaw, and the report shows how each solved mount differs from CAD. |
| `--reference-spot N=x,y,yawDeg` | Instead of CAD: the robot's pose on the field at still spot N (pushed into a known corner). |
| `--anchor-camera NAME=x,y,yawDeg` | Instead of CAD: one camera's x, y and yaw. |
| `--photon-db photon.sqlite` | Lens calibrations from PhotonVision's database, for recordings made before `photonvision-24` (their `session.json` has no calibrations). It's in `/opt/photonvision/photonvision_config/` on the Jetson. |
| `--calibration NAME=file.json` | A camera's calibration from PhotonVision's calibration export. |
| `--every N` | Analyse every Nth frame (default: about 5 per second). |
| `--prior-cm`, `--prior-deg` | How far tags may move from the layout before the solver resists (default 5 cm, 2°). |

## What it does

1. **Detect** tags in the recorded frames with WPILib's AprilTag detector at full resolution. Two
   changes from WPILib's defaults: the minimum cluster size is 24 px, not 300, so tags smaller than
   about 35 px across (more than ~4 m away) still count; and the corners are shifted by −0.5 px,
   because AprilTag puts pixel centres at +0.5 and OpenCV (so the lens calibration) at 0.
2. **Find the still stretches:** times when every camera's tag corners stayed within 1.5 px, for at
   least 1 s. Each (stretch, camera, tag) becomes one observation, the median of its corners.
3. **Start** from the official layout (multi-tag PnP per camera, then every camera's view of a spot
   at once).
4. **Bundle adjustment** (scipy `least_squares`, robust loss) of:
   - each spot: the robot's x, y and heading (level on the floor);
   - the reference camera's height, roll and pitch, and every other camera's full pose;
   - every tag's full pose, with a weak, robust pull toward the layout.

   Spots and cameras that don't fit the official layout well at first (a tag that moved, seen up
   close) join in later rounds, once the tags are solved. Views more than 4 px off are dropped as
   outliers.
5. **Line the map up with the layout.** Vision can't tell where the whole map sits on the field.
   The solver picks the shift and turn that the most tags agree with (within 2 cm), so a misplaced
   field element doesn't drag the rest.
6. **Report:** corrected layout, mounts (with CAD differences and a Java snippet), each tag's offset
   and verdict, per-camera fit and noise factor, and a lens check.

## Checking it without a field

```bash
~/build/fieldcal-venv/bin/python tools/fieldcal/tests/test_observations.py 1 2 3 4 5 6 7 8
```

```bash
~/build/fieldcal-venv/bin/python tools/fieldcal/tests/test_observations.py 1 2 3 --big
```

```bash
tools/fieldcal/tests/test_images.sh
```

- `test_observations.py`: the solver on exact synthetic corners plus 0.3 px noise, on half the
  2026 field, with 4 corner cameras, 16 spots, and about a third of the tags moved by ~2 cm and ~1°.
  `--big` adds a whole field element 15 cm off, one tag 25 cm off and one turned 5°.
- `test_images.sh`: the whole pipeline on a rendered recording, using the official tag images,
  our lens calibration, blur, noise and JPEG. It renders about 1.5 min of data, then solves in
  seconds.

**Results (2026-09-24):**

| Test | Tags | Mounts |
|---|---|---|
| Observations, 8 seeds | median 0.2–0.7 cm, 0.2–0.3° | about 1 cm or better |
| With big layout errors | the 15 cm and 25 cm moves found within about 1 cm | about 1 cm or better |
| Rendered recordings, 2 seeds | median 0.2–0.4 cm | height within 4 mm, pitch/roll within 0.03°, x/y within 2 mm, yaw within 0.02° |

On rendered recordings, the report also found both mistakes planted in the test's CAD file: a
camera's pitch off by 1.5°, and another's height off by 1 cm.

## Things we learned building it

- **The lens calibrations don't reach the image corners.** Our OpenCV 8-coefficient calibrations
  turn back past about 47° (TopRight) and 49° (TopLeft) off-axis: 4% and 1% of the image can't be
  modelled. A tag there appears to be somewhere it isn't. The tool ignores those areas and says so.
  A calibration with board views right into the corners fixes it, and the robot's own pose
  estimates would benefit too.
- **WPILib's detector misses small tags by default** (`minClusterPixels` 300).
- **AprilTag's corners are +0.5 px from OpenCV's convention.** This is a 0.04° bias at our focal
  length: negligible on the robot, but visible in a calibration.
- **OpenCV's `DICT_APRILTAG_36h11` marker image is the real tag rotated 180°.** The renderer uses
  the AprilTag library's own images instead.

## Files

- `fieldcal/`: `camera.py` (lens model), `tags.py` (detector, tag geometry), `rewind.py` (both
  recording formats), `segments.py` (still stretches), `solve.py` (initialisation, bundle
  adjustment, alignment, anchors), `report.py`, `synth.py` (synthetic truth and rendering).
- `layouts/2026-rebuilt-andymark.json`: the layout from our PhotonVision (32 tags, 16.518 × 8.043 m).
