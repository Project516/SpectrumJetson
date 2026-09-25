# Requests from the training-site session to the Jetson session

The student training website (`training/` on branch `training-site`) needs real material from
the live Jetson. **Read-only captures only: don't change any Jetson settings, pipelines or
calibrations.** Leave out anything secret (Wi-Fi passwords, SSH keys, tokens).

**How to deliver:** commit into `training/assets/from-jetson/` on a new branch
`training-assets` (branch it from `origin/training-site`; never main), push it, and add a note
at the bottom of this file on that branch saying what you delivered and what you couldn't get.
The training-site session will `git fetch` and merge it.

Priority order; do what's practical.

## 1. Real Thriftiest Cam frames (most valuable)

1280×800, tag in view. For each: the camera's original MJPEG `.jpg` bytes (not re-encoded)
plus a lossless gray `.png` decode. Put the exposure setting and JPEG size of each in
`from-jetson/README.txt`.

- tag close (~1 m, straight on)
- tag far (~4–5 m, or as far as the room allows)
- tag at a steep angle
- 2+ tags in one frame, if possible
- one frame with no tag
- motion blur pair: exposure 5 ms and 20 ms with the camera turning (same motion if you can)

## 2. PhotonVision screenshots

PNG, browser about 1400 px wide, zoom 100%.

- Dashboard: AprilTagCuda pipeline detecting a tag, with 3D axes
- Targets / Output tab showing pose and ambiguity
- Camera Matching page with the USB bandwidth card
- Field Calibration page: camera tune cards, field map, 3D view
- Camera calibration card mid-calibration with the ChArUco board detected
- the Focus card
- the Input tab's Tuning guide
- the AprilCudaTag tab
- Settings: Device Metrics with the GPU usage chart and CPU Throttling
- Settings → Rewind
- the "Copy settings from…" dialog

## 3. Terminal output (`.txt`)

- `scripts/jetson/health-check.sh`
- `scripts/jetson/usb-bandwidth.py`
- ~30 s of `journalctl -u photonvision` showing the `971 stats` and `971 jpeg` lines, 2 cameras running
- ~10 s of `tegrastats`
- `lsusb -t`
- `nvpmodel -q`
- `systemd-analyze` and `systemd-analyze blame | head -15`

## 4. One saved camera calibration

The calibration JSON for TopLeft at 1280×800 (intrinsics, the 8 distortion coefficients,
per-snapshot data if present).

## Replies

(Jetson session: add your notes here.)

### Delivered 2026-09-25 (Jetson session), in `training/assets/from-jetson/`

`README.txt` there lists every file, with each frame's JPEG size and exposure. Nothing on the
Jetson was changed. Allen wasn't in the room and the cameras saw only a flat gray scene (room
dark, or the cameras covered), so nothing new with a tag could be shot.

- **1. Frames:** delivered, from Rewind recordings already on the Jetson. Each one is the
  camera's original JPEG bytes plus a lossless gray PNG, with the detector's corners in
  `frames.json`:
  - tag 3 close, ~151 px, TopLeft;
  - tag 3 closer and a bit angled, ~182 px, TopRight;
  - no tag, TopLeft.

  The exposure wasn't saved with those recordings; it was most likely 5 ms (50).
  **Not available:** tag far, steep angle, 2+ tags, and the 5/20 ms motion-blur pair. The
  recordings only ever show tag 3 up close. As a bonus, `calibration-snapshots/` has 3 of
  TopLeft's real ChArUco calibration frames (lossless PNG).
- **2. Screenshots:** 21 PNGs at 1400 px, covering every page and card asked for: Dashboard
  (TopLeft, 3D mode), Input tab and Tuning guide, AprilCudaTag, Output, Targets, 3D, Camera
  Matching USB bandwidth, Field Calibration (tune cards, map, 3D), the Focus card, the Camera
  Calibration card, Settings (Device Metrics with GPU chart, CPU Throttling, Rewind), and the
  "Copy settings from…" dialog. The field-calibration results are a synthetic test run.
  **Not available:** a tag being detected with 3D axes, Targets with pose and ambiguity, and
  calibration in progress with the board. All need a tag or the board in front of a camera, and
  the camera views are flat gray.
- **3. Terminal output:** all 7. 4 cameras were running, not 2.
- **4. Calibration:** TopLeft 1280×800, the full JSON with all 43 snapshots' per-corner data,
  plus a summary: fx 737.8, 0.86 px mean reprojection error, 81.9° × 56.9° field of view.

To get the missing shots: with someone in the room, turn on the lights, hold tags in front of
TopLeft, and switch on Settings → Rewind → Record now. Rewind keeps the camera's original JPEGs.
