#!/usr/bin/env python3
"""Figure out which ChArUco board settings match a physical board.

Grabs one frame from a PhotonVision MJPEG stream (or reads an image file), detects the
ArUco markers, and tries both board orientations with the old and new OpenCV layouts,
reporting how many ChArUco corners each recovers. The right settings recover (nearly)
all of them; wrong ones recover few or none, which in PhotonVision shows up as
failed calibrations ("Negative corner in reprojection error calc", null intrinsics).

Run ON THE JETSON (NVIDIA's OpenCV 4.8 has cv2.aruco):
  python3 check_board.py --stream http://127.0.0.1:1183/stream.mjpg \
      --squares 9 12 --square-mm 30 --marker-mm 22 --dict DICT_5X5_1000
"""
import argparse
import sys
import urllib.request

import cv2
import numpy as np


def grab_mjpeg_frame(url, timeout=5.0):
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        buf = b""
        while len(buf) < 8_000_000:
            chunk = resp.read(65536)
            if not chunk:
                break
            buf += chunk
            start = buf.find(b"\xff\xd8")
            end = buf.find(b"\xff\xd9", start + 2) if start >= 0 else -1
            if start >= 0 and end >= 0:
                img = cv2.imdecode(np.frombuffer(buf[start:end + 2], np.uint8),
                                   cv2.IMREAD_GRAYSCALE)
                if img is not None:
                    return img
    raise RuntimeError(f"no JPEG frame from {url}")


def main():
    ap = argparse.ArgumentParser()
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--stream")
    src.add_argument("--image")
    ap.add_argument("--squares", type=int, nargs=2, required=True, metavar=("A", "B"))
    ap.add_argument("--square-mm", type=float, required=True)
    ap.add_argument("--marker-mm", type=float, required=True)
    ap.add_argument("--dict", default="DICT_5X5_1000")
    ap.add_argument("--save", help="write the frame used here")
    args = ap.parse_args()

    gray = (grab_mjpeg_frame(args.stream) if args.stream
            else cv2.imread(args.image, cv2.IMREAD_GRAYSCALE))
    if gray is None:
        sys.exit("could not read image")
    if args.save:
        cv2.imwrite(args.save, gray)
    print(f"frame {gray.shape[1]}x{gray.shape[0]}")

    dictionary = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, args.dict))
    corners, ids, _ = cv2.aruco.ArucoDetector(
        dictionary, cv2.aruco.DetectorParameters()).detectMarkers(gray)
    n = 0 if ids is None else len(ids)
    print(f"markers found: {n}" + (f", ids {ids.min()}..{ids.max()}" if n else ""))
    if n == 0:
        sys.exit("No markers: check the dictionary, focus, exposure, or stream resolution.")

    a, b = args.squares
    results = []
    for sx, sy in ((a, b), (b, a)):
        for legacy in (False, True):
            board = cv2.aruco.CharucoBoard((sx, sy), args.square_mm / 1000,
                                           args.marker_mm / 1000, dictionary)
            board.setLegacyPattern(legacy)
            ch_corners, ch_ids, _, _ = cv2.aruco.CharucoDetector(board).detectBoard(gray)
            got = 0 if ch_ids is None else len(ch_ids)
            total = (sx - 1) * (sy - 1)
            expected_markers = (sx * sy) // 2
            results.append((got, sx, sy, legacy, total, expected_markers))
            print(f"  width {sx:2d} x height {sy:2d}, old pattern {'ON ' if legacy else 'off'}:"
                  f" {got:3d}/{total} corners (board has {expected_markers} markers,"
                  f" ids 0..{expected_markers - 1})")
    best = max(results)
    got, sx, sy, legacy, total, _ = best
    print()
    if got == 0:
        print("No configuration recovered corners: check square/marker sizes and dictionary.")
    else:
        print(f"Best: Board Width {sx}, Board Height {sy}, Old OpenCV Pattern "
              f"{'ON' if legacy else 'off'} ({got}/{total} corners visible in this frame)")


if __name__ == "__main__":
    main()
