"""AprilTag 36h11: the corner model, the official tag images, and detection.

Two checks made on 2026-09-24 (see tools/fieldcal/README.md):

* OpenCV's DICT_APRILTAG_36h11 marker images are the official AprilTag images rotated 180°, and
  OpenCV reports corners in its own marker orientation. So detection uses WPILib's detector (the
  one PhotonVision's CPU pipeline uses), and synthetic images use the official images from the
  AprilTag C library.
* WPILib returns an upright tag's corners as bottom-left, bottom-right, top-right, top-left (as
  seen). Its own pose estimator agrees with the model below.
"""

from __future__ import annotations

import ctypes
import glob
import os
from dataclasses import dataclass

import numpy as np

import robotpy_apriltag as rat  # also loads libwpiutil and libapriltag

# FRC tags since 2024: 36h11, 6.5 in (165.1 mm) black square.
DEFAULT_TAG_SIZE = 0.1651


def corner_model(size: float = DEFAULT_TAG_SIZE) -> np.ndarray:
    """The four corners in the tag's frame (NWU, +x out of the face), in the order seen by a
    viewer facing the upright tag: top-left, top-right, bottom-right, bottom-left. Facing the tag,
    the viewer's right is the tag's +y."""
    h = size / 2
    return np.array([[0, -h, h], [0, h, h], [0, h, -h], [0, -h, -h]], float)


@dataclass
class Detection:
    id: int
    corners: np.ndarray  # 4x2 pixels, top-left, top-right, bottom-right, bottom-left
    margin: float


class Detector:
    """WPILib's AprilTag detector for 36h11, at full resolution for the best corners."""

    def __init__(self, decimate: float = 1.0, max_hamming: int = 0, min_margin: float = 15.0,
                 min_cluster_px: int = 24):
        self.det = rat.AprilTagDetector()
        self.det.addFamily("tag36h11", max_hamming)
        cfg = self.det.getConfig()
        cfg.quadDecimate = decimate
        cfg.refineEdges = True
        self.det.setConfig(cfg)
        # WPILib's default of 300 pixels per edge cluster drops any tag under about 35 px across,
        # i.e. every tag more than ~4 m away on our cameras. Those still help the map.
        qt = self.det.getQuadThresholdParameters()
        qt.minClusterPixels = min_cluster_px
        self.det.setQuadThresholdParameters(qt)
        self.min_margin = min_margin

    def detect(self, gray: np.ndarray) -> list[Detection]:
        out = []
        for r in self.det.detect(gray):
            if r.getDecisionMargin() < self.min_margin:
                continue
            # AprilTag puts pixel centres at +0.5 (a pixel spans 0..1); OpenCV, and so the lens
            # calibration, puts them at integers. Measured on rendered frames: +0.50, +0.47 px.
            c = np.array([[r.getCorner(i).x, r.getCorner(i).y] for i in range(4)]) - 0.5
            out.append(Detection(r.getId(), c[[3, 2, 1, 0]], r.getDecisionMargin()))
        return out


class _ImageU8(ctypes.Structure):
    _fields_ = [
        ("width", ctypes.c_int32),
        ("height", ctypes.c_int32),
        ("stride", ctypes.c_int32),
        ("buf", ctypes.POINTER(ctypes.c_uint8)),
    ]


_lib = None
_family = None


def official_tag_cells(tag_id: int) -> np.ndarray:
    """The official 36h11 image for a tag: 8x8 cells (0 black, 255 white), the part that the tag
    size measures (the black border square), upright."""
    global _lib, _family
    if _lib is None:
        base = os.path.dirname(rat.__file__)
        path = glob.glob(os.path.join(base, "..", "native", "apriltag", "lib", "libapriltag.so*"))[0]
        _lib = ctypes.CDLL(path, mode=ctypes.RTLD_GLOBAL)
        _lib.tag36h11_create.restype = ctypes.c_void_p
        _lib.apriltag_to_image.restype = ctypes.POINTER(_ImageU8)
        _lib.apriltag_to_image.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
        _family = _lib.tag36h11_create()
    im = _lib.apriltag_to_image(_family, tag_id).contents
    a = np.ctypeslib.as_array(im.buf, shape=(im.height, im.stride))[:, : im.width].copy()
    return a[1:-1, 1:-1]  # drop the 1-cell white quiet zone
