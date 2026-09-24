"""Finding the stretches where the robot stood still, and turning them into observations.

The robot is pushed by hand between spots and held still for 2-3 s at each. Nobody presses a
button: a stretch counts as still when no camera's tag corners moved more than a pixel or so from
one analysed frame to the next, for at least a second. Each (still stretch, camera, tag) becomes one
observation: the median of that tag's corners over the stretch.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class Observation:
    segment: int
    camera: str
    tag: int
    corners: np.ndarray  # 4x2 pixels, TL TR BR BL
    frames: int


@dataclass
class Segment:
    index: int
    start: float
    end: float


def _merge(iv: list[tuple[float, float]], gap: float = 0.0) -> list[tuple[float, float]]:
    out: list[list[float]] = []
    for a, b in sorted(iv):
        if out and a <= out[-1][1] + gap:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return [(a, b) for a, b in out]


def find_still_segments(
    detections: dict[str, list[tuple[float, dict[int, np.ndarray]]]],
    max_motion_px: float = 1.5,
    min_still_s: float = 1.0,
    max_gap_s: float = 0.5,
) -> list[Segment]:
    """``detections``: per camera, a time-ordered list of (t, {tag id: 4x2 corners}).

    Each pair of consecutive analysed frames of a camera that share a tag is evidence: still (no
    corner moved more than ``max_motion_px``) or moving. A still stretch is time covered by still
    evidence and by no moving evidence from any camera."""
    still_iv, moving_iv = [], []
    for frames in detections.values():
        prev = None
        for t, tags in frames:
            if prev is not None and tags and t - prev[0] < max_gap_s:
                common = set(tags) & set(prev[1])
                if common:
                    m = max(float(np.max(np.linalg.norm(tags[i] - prev[1][i], axis=1))) for i in common)
                    (still_iv if m <= max_motion_px else moving_iv).append((prev[0], t))
                elif set(tags) != set(prev[1]):
                    moving_iv.append((prev[0], t))  # the view changed completely: turning
            prev = (t, tags)
    moving = _merge(moving_iv)
    segs = []
    for a, b in _merge(still_iv, gap=0.05):
        # Cut out any time another camera saw motion.
        pieces = [(a, b)]
        for ma, mb in moving:
            nxt = []
            for pa, pb in pieces:
                if mb <= pa or ma >= pb:
                    nxt.append((pa, pb))
                    continue
                if ma > pa:
                    nxt.append((pa, ma))
                if mb < pb:
                    nxt.append((mb, pb))
            pieces = nxt
        for pa, pb in pieces:
            if pb - pa >= min_still_s:
                segs.append((pa, pb))
    return [Segment(i, a, b) for i, (a, b) in enumerate(sorted(segs))]


def observations(
    detections: dict[str, list[tuple[float, dict[int, np.ndarray]]]],
    segments: list[Segment],
    min_frames: int = 3,
) -> list[Observation]:
    out = []
    for seg in segments:
        # Trim the edges a little: the robot may still be settling.
        lo, hi = seg.start + 0.1, seg.end - 0.1
        for cam, frames in detections.items():
            per_tag: dict[int, list[np.ndarray]] = {}
            for t, tags in frames:
                if lo <= t <= hi:
                    for tid, c in tags.items():
                        per_tag.setdefault(tid, []).append(c)
            for tid, cs in per_tag.items():
                if len(cs) >= min_frames:
                    out.append(Observation(seg.index, cam, tid, np.median(np.array(cs), axis=0), len(cs)))
    return out
