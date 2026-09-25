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
