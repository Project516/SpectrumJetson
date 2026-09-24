#!/usr/bin/env python3
"""Colour test "recordings" for tests/jpeg-hw (our Thriftiest Cams are mono, so their JPEGs carry no
colour). Takes real colour photos already on the Jetson (Ubuntu's wallpapers and OpenCV's sample
images), pans a 1280x800 window across each, and writes the frames as baseline JPEGs back to back,
like a Rewind .mjpeg: 4:2:2 (what UVC cameras send) at quality 50/80/95, plus 4:2:0 and 4:4:4, which
the hardware colour path must refuse. Saturated colour bars test the clamping.

Usage: make-colour-recordings.py OUTDIR    (needs python3-pil and numpy)
"""
import io
import os
import sys

import numpy as np
from PIL import Image

W, H = 1280, 800
SOURCES = [
    '/usr/share/backgrounds/Blue_flower_by_Elena_Stravoravdi.jpg',
    '/usr/share/backgrounds/Cherry_Tree_in_Lakones_by_elenastravoravdi.jpg',
    '/usr/share/backgrounds/Optical_Fibers_in_Dark_by_Elena_Stravoravdi.jpg',
    '/usr/share/backgrounds/DSC2943_by_kcpru.jpg',
    '/usr/share/backgrounds/canvas_by_roytanck.jpg',
    '/usr/share/opencv4/samples/data/fruits.jpg',
    '/usr/share/opencv4/samples/data/baboon.jpg',
    '/usr/share/opencv4/samples/data/smarties.png',
    '/usr/share/opencv4/samples/data/starry_night.jpg',
    '/usr/share/opencv4/samples/data/HappyFish.jpg',
]


def pan(img, n):
    img = img.convert('RGB')
    w, h = img.size
    s = max(W / w, H / h) * 1.15
    img = img.resize((int(w * s) + 1, int(h * s) + 1), Image.LANCZOS)
    w, h = img.size
    for k in range(n):
        x, y = int((w - W) * k / (n - 1)), int((h - H) * k / (n - 1))
        yield img.crop((x, y, x + W, y + H))


def bars():
    a = np.zeros((H, W, 3), np.uint8)
    cols = [(255, 255, 255), (255, 255, 0), (0, 255, 255), (0, 255, 0), (255, 0, 255), (255, 0, 0),
            (0, 0, 255), (0, 0, 0)]
    for i, c in enumerate(cols):
        a[:H // 2, i * W // 8:(i + 1) * W // 8] = c
    g = np.linspace(0, 255, W).astype(np.uint8)
    a[H // 2:3 * H // 4, :, 0], a[H // 2:3 * H // 4, :, 1], a[H // 2:3 * H // 4, :, 2] = g, 255 - g, 255
    a[3 * H // 4:, :, 0], a[3 * H // 4:, :, 1], a[3 * H // 4:, :, 2] = 255, g, 0
    for k in range(8):
        yield Image.fromarray(np.roll(a, k * 37, axis=1))


def main(out):
    os.makedirs(out, exist_ok=True)
    sources = [p for p in SOURCES if os.path.exists(p)]
    if not sources:
        sys.exit('none of the source photos exist on this machine')
    for name, sub, qualities in (('422', 1, (50, 80, 95)), ('420', 2, (80,)), ('444', 0, (80,))):
        for q in qualities:
            path = os.path.join(out, 'colour_%s_q%d.mjpeg' % (name, q))
            n = 0
            with open(path, 'wb') as f:
                per = 24 if (name, q) == ('422', 80) else 6
                frames = [fr for p in sources for fr in pan(Image.open(p), per)] + list(bars())
                for fr in frames:
                    b = io.BytesIO()
                    fr.save(b, 'JPEG', quality=q, subsampling=sub)
                    f.write(b.getvalue())
                    n += 1
            print('%s: %d frames' % (path, n))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '/tmp/jpeg-hw-colour')
