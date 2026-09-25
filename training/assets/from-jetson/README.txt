Real material from the team's Jetson (photonvision-3847, Orin Nano Super, L4T R36.5.2), for the
training site. Captured 2026-09-25 by the Jetson session, read-only: no Jetson settings, pipelines
or calibrations were changed. Nothing secret is included (no Wi-Fi passwords, keys or tokens).

At capture time: 4 AprilTag cameras running (TopLeft and TopRight = Thriftiest Cams, USB
1bcf:28c5, 1280x800 mono at 122 fps; two global-shutter cameras, USB 32e4:0144, 1280x720 at
60 fps). Hardware JPEG decode (NVJPG) on. The cameras saw only flat gray (the room dark, or the
cameras covered) and nobody was there, so the live camera views in the screenshots are flat
gray, and no new frames with tags could be taken.


frames/  Real Thriftiest Cam frames, from Rewind recordings on the Jetson's SSD
-----------------------------------------------------------------------------
Each .jpg is the camera's own MJPEG frame, byte for byte (Rewind saves the camera's JPEG without
re-encoding). Each .png is a lossless 8-bit gray decode of it: the JPEG's luma, decoded straight
to grayscale, which is what the AprilTag detector sees. All are 1280x800, baseline JPEG, 4:2:2.
frames.json has each frame's recording, frame number, and the tags the Jetson's CUDA detector
found in it (id, decision margin, corner pixels; replayed with min_white_black_diff 20, the
robot setting).

  file                         camera    JPEG size  tag                       exposure
  tag-close_TopLeft            TopLeft   52,801 B   id 3, ~151 px, margin 90  see note
  tag-close-bigger_TopRight    TopRight  60,415 B   id 3, ~182 px, margin 85  see note
  no-tag_TopLeft               TopLeft   49,745 B   none                      see note

  tag-close_TopLeft: recording 0007_bench_20260924-061447, frame 51. Tag on a box against the
    wall, camera looking slightly down; the tag's sides differ by 13% (nearly straight on).
    About 0.8 m away if it's a full-size 6.5 in tag (fx = 738 px from the calibration).
  tag-close-bigger_TopRight: recording 0008_bench_20260924-064804, frame 12. Same tag, closer
    and a little more angled (sides differ by 20%).
  no-tag_TopLeft: recording 0009_bench_20260924-070338, frame 78. The bench, no tag.

  Exposure note: these three recordings came before Rewind saved camera settings with each
  recording, and the system log from that day is gone. The team setting at the time was
  exposure 50 = 5 ms (100 us units), so 5 ms is most likely, but it isn't recorded. The later
  recording that did save settings (0011) says exposure 50, but its frames are flat gray too
  (like the cameras tonight), so none are included.

  Not captured (nobody could be in the room): tag far (~4-5 m), tag at a steep angle, 2+ tags in
  one frame, and the 5 ms / 20 ms motion-blur pair. The recordings on the Jetson only ever show
  tag 3 at about 150-180 px.

calibration-snapshots/  Real ChArUco board frames from TopLeft's calibration
----------------------------------------------------------------------------
Lossless PNGs that PhotonVision saved during TopLeft's 1280x800 calibration (43 snapshots; these
are 3 of them). No JPEG originals exist for these. They stand in for the "mid-calibration"
screenshot, which needs someone holding the board. snapshots.json has each one's board distance
and tilt (from the solved calibration) and how many of the 88 inner corners were used.

  nearest_img22      board 0.27 m away, nearly flat to the camera (2 deg), 83 of 88 corners
  farthest_img15     0.55 m, tilted 39 deg, all 88 corners
  most-tilted_img23  0.50 m, tilted 45 deg, 78 corners

calibration/  TopLeft's saved calibration at 1280x800
------------------------------------------------------
  TopLeft-1280x800.json          PhotonVision's calibration as stored: intrinsics, 8 OpenCV
                                 distortion coefficients, board info, and all 43 snapshots'
                                 per-corner data (object points, image points, reprojection
                                 errors, board pose).
  TopLeft-1280x800-summary.txt   The key numbers: fx 737.84, fy 737.67, cx 650.49, cy 362.44;
                                 ChArUco 12x9 squares (11x8 inner corners), 30 mm; mean reprojection error 0.86 px
                                 (RMS 1.03) over 3486 corners; field of view 81.9 x 56.9 deg; a
                                 per-snapshot table.

screenshots/  PhotonVision (our fork), headless Chrome, 1400 px wide, zoom 100%
--------------------------------------------------------------------------------
  dashboard-topleft-3d-input-tab.png   Dashboard, TopLeft, AprilTagCuda pipeline in 3D mode,
                                       Input tab. No tag in view, so no 3D axes are drawn.
  dashboard-input-tuning-guide.png     The Input tab's Tuning guide, expanded (cropped);
                                       ...-full-page.png is the whole page with it open.
  dashboard-aprilcudatag-tab.png       The AprilCudaTag tab.
  dashboard-output-tab.png             The Output tab (3D and multi-tag options).
  dashboard-targets-tab.png            The Targets tab: empty table (no tag in view), so no pose
                                       or ambiguity values.
  dashboard-3d-tab.png                 The 3D tab.
  copy-settings-dialog.png             The pipeline menu's "Copy settings from..." dialog, opened
                                       on TopLeft (cancelled; nothing was copied).
  camera-page-full.png                 Camera page: TopLeft's calibration table and the Focus card.
  camera-calibration-card.png          The Camera Calibration card (not mid-calibration; see
                                       calibration-snapshots/).
  camera-focus-card.png                The Focus card, with Measure off (a flat dark image gives a
                                       meaningless score).
  camera-matching-usb-bandwidth.png    Camera Matching's USB bandwidth card (4 cameras, 3840 of
                                       ~6720 bytes per microframe).
  camera-matching-page.png             The top of the Camera Matching page.
  field-calibration-camera-tune.png    Field Calibration step 1: the per-camera Tune cards.
  field-calibration-results-map.png    Field Calibration results with the tag MAP view.
  field-calibration-results-3d.png     The same with the 3D field view.
  field-calibration-page-full.png      The whole Field Calibration page.
    (The field-calibration results shown are from a synthetic test run, "Synthetic-test", not a
    real field.)
  settings-top.png                     Settings: Device Control (incl. CPU Throttling) beside
                                       Device Metrics (CPU, GPU usage chart, memory, temperature).
  settings-device-control.png          Device Control alone.
  settings-device-metrics.png          Device Metrics alone.
  settings-rewind.png                  Settings -> Rewind: Record now switch and recent recordings.

  The live camera views are the dashboard stream at 213x133 (the team's default stream size),
  and flat gray (see the top of this file).

  Not captured: the dashboard detecting a tag with 3D axes, the Targets tab with pose and
  ambiguity, and calibration in progress with the board detected. All need a tag or the board
  in front of a camera.

terminal/  Plain-text command output, 2026-09-25 07:53 UTC
---------------------------------------------------------
  health-check.txt            scripts/jetson/health-check.sh 4 (READY, 3 warnings: calibration
                              on only 2 of 4 cameras, no robot connected, Wi-Fi on)
  usb-bandwidth.txt           scripts/jetson/usb-bandwidth.py
  journalctl-971-stats.txt    30 s of `journalctl -u photonvision`, just the "971 stats" (one
                              line per camera per second) and "971 jpeg" (every 10 s) lines.
                              4 cameras were running, not 2; no tags in view (tags/frame 0).
  tegrastats.txt              10 s of tegrastats
  lsusb-t.txt                 lsusb -t
  nvpmodel-q.txt              nvpmodel -q (MAXN_SUPER)
  systemd-analyze.txt         systemd-analyze, then systemd-analyze blame | head -15
