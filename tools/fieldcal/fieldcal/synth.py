"""Synthetic field-calibration data with a known answer, for testing the solver without a field.

``truth``: a layout with some tags moved by a few cm and turned by a degree or so, a camera rig
with known mounts, and robot spots on part of the field. From that, either observations (corners
plus pixel noise) or a whole Rewind-format recording: every camera's frames rendered with the
official tag images, the lens distortion, blur, noise and JPEG compression, with the robot held
still at each spot and moving in between.
"""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from . import geometry as g
from .camera import Camera
from .segments import Observation
from .tags import corner_model, official_tag_cells

# TopRight's bench calibration (2026-09-23): OV9281, 1280x800.
TOPRIGHT = dict(
    width=1280, height=800, fx=736.985, fy=737.214, cx=597.901, cy=371.578,
    dist=[0.1313, 0.0912, 5.2e-05, -0.000437, -0.0969, 0.0520, 0.0949, 0.0682],
)


@dataclass
class Truth:
    layout: dict[int, np.ndarray]  # the field as built (what the solver should find)
    official: dict[int, np.ndarray]  # the layout file the solver is given
    cameras: dict[str, Camera]
    mounts: dict[str, np.ndarray]  # T_robot_cam (WPILib camera axes)
    spots: list[np.ndarray]  # T_field_robot per spot

    def to_json(self) -> dict:
        def xyzrpy(T):
            r, p, y = g.to_rpy(T[:3, :3])
            return [*T[:3, 3].tolist(), np.degrees(r), np.degrees(p), np.degrees(y)]

        return {
            "tags": {str(k): g.to_wpilib_pose(v) for k, v in self.layout.items()},
            "mounts": {k: xyzrpy(v) for k, v in self.mounts.items()},
            "spots": [xyzrpy(T) for T in self.spots],
        }


def default_mounts() -> dict[str, np.ndarray]:
    """Four corner cameras, 0.45 m up, tilted up 15°, facing out at 30° / 150°."""
    out = {}
    for name, x, y, yaw in [("TopLeft", 0.26, 0.26, 30), ("TopRight", 0.26, -0.26, -30),
                            ("BottomLeft", -0.26, 0.26, 150), ("BottomRight", -0.26, -0.26, -150)]:
        out[name] = g.make(g.rpy(0.0, np.radians(-15), np.radians(yaw)), [x, y, 0.45])
    return out


def make_truth(official: dict[int, np.ndarray], field_length: float, field_width: float, seed: int = 1,
               spots: int = 16, half_field: bool = True, moved_fraction: float = 0.35,
               mounts: dict[str, np.ndarray] | None = None) -> Truth:
    rng = np.random.default_rng(seed)
    x_max = field_length / 2 if half_field else field_length
    tags = {k: v for k, v in official.items() if v[0, 3] <= x_max}
    built = {}
    for k, T in tags.items():
        if rng.random() < moved_fraction:
            dt = rng.normal(0, 0.02, 3)
            dR = g.rpy(*np.radians(rng.normal(0, 1.0, 3)))
            built[k] = g.make(T[:3, :3] @ dR, T[:3, 3] + dt)
        else:
            built[k] = T.copy()
    mounts = mounts or default_mounts()
    cams = {n: Camera(n, **{k: v for k, v in TOPRIGHT.items() if k != "dist"}, dist=np.array(TOPRIGHT["dist"])) for n in mounts}
    spot_list = []
    tries = 0
    while len(spot_list) < spots and tries < 10000:
        tries += 1
        T = g.planar(rng.uniform(1.2, x_max - 0.8), rng.uniform(1.0, field_width - 1.0), rng.uniform(-np.pi, np.pi))
        n_seen = sum(len(visible(cams[c], T @ mounts[c], built)) for c in cams)
        if n_seen >= 3:
            spot_list.append(T)
    return Truth(built, {k: official[k] for k in official}, cams, mounts, spot_list)


def visible(cam: Camera, T_field_camnwu: np.ndarray, layout: dict[int, np.ndarray], size: float = 0.1651,
            max_dist: float = 7.0) -> dict[int, np.ndarray]:
    """Tags this camera would detect, with their exact corners."""
    model = np.c_[corner_model(size), np.ones(4)]
    T_camcv_field = g.inv(g.nwu_to_cv(T_field_camnwu))
    cam_pos = T_field_camnwu[:3, 3]
    out = {}
    for k, T in layout.items():
        to_cam = cam_pos - T[:3, 3]
        d = np.linalg.norm(to_cam)
        if d > max_dist or np.dot(T[:3, 0], to_cam) / d < np.cos(np.radians(70)):
            continue
        P = (T_camcv_field @ T @ model.T).T[:, :3]
        uv = cam.project(P)
        if not cam.in_image(uv, margin=12).all():
            continue
        if cv2.contourArea(uv.astype(np.float32)) < 200:
            continue
        out[k] = uv
    return out


def observations(truth: Truth, pixel_noise: float = 0.3, seed: int = 2) -> list[Observation]:
    rng = np.random.default_rng(seed)
    obs = []
    for s, T in enumerate(truth.spots):
        for c, cam in truth.cameras.items():
            for k, uv in visible(cam, T @ truth.mounts[c], truth.layout).items():
                obs.append(Observation(s, c, k, uv + rng.normal(0, pixel_noise, uv.shape), 30))
    return obs


# --- rendering a Rewind recording


class _Renderer:
    def __init__(self, cam: Camera, size: float):
        self.cam, self.size = cam, size
        u, v = np.meshgrid(np.arange(cam.width, dtype=np.float32), np.arange(cam.height, dtype=np.float32))
        pts = np.stack([u.ravel(), v.ravel()], axis=1).reshape(-1, 1, 2)
        crit = (cv2.TERM_CRITERIA_COUNT | cv2.TERM_CRITERIA_EPS, 40, 1e-7)
        if hasattr(cv2, "undistortPointsIter"):  # OpenCV 4
            und = cv2.undistortPointsIter(pts, cam.K, cam.dist8(), None, None, crit)
        else:  # OpenCV 5 folded it into undistortPoints
            und = cv2.undistortPoints(pts, cam.K, cam.dist8(), criteria=crit)
        und = und.reshape(-1, 2)
        # Pixels the distortion model can't reach (past its turning radius, often the far corners)
        # stay background: their "ray" doesn't project back to them.
        back = cam.project(np.c_[und, np.ones(len(und))])
        ok = np.linalg.norm(back - pts.reshape(-1, 2), axis=1) < 0.5
        rays = np.c_[und, np.ones(len(und))].astype(np.float32)
        rays[~ok] = [0, 0, 1]
        self.rays = rays.reshape(cam.height, cam.width, 3)
        self.valid = ok.reshape(cam.height, cam.width)
        self.cells = {}

    def render(self, T_field_camnwu, layout, rng) -> np.ndarray:
        cam, S = self.cam, self.size
        img = np.clip(rng.normal(110, 4, (cam.height, cam.width)), 0, 255).astype(np.float32)
        T_camcv_field = g.inv(g.nwu_to_cv(T_field_camnwu))
        for k, uv in visible(cam, T_field_camnwu, layout, S, max_dist=8.0).items():
            T = T_camcv_field @ layout[k]  # tag in the camera frame
            R, t = T[:3, :3], T[:3, 3]
            n = R[:, 0]  # tag normal
            # Paper: the 8x8 tag plus a 1-cell white border each side (10x10 cells).
            border = S * 10 / 8
            corners = np.array([[0, -border / 2, border / 2], [0, border / 2, border / 2],
                                [0, border / 2, -border / 2], [0, -border / 2, -border / 2]])
            puv = cam.project((R @ corners.T).T + t)
            if not np.isfinite(puv).all():
                continue
            x0, y0 = np.floor(np.maximum(puv.min(axis=0) - 3, 0)).astype(int)
            x1, y1 = np.ceil(np.minimum(puv.max(axis=0) + 3, [cam.width - 1, cam.height - 1])).astype(int)
            rays = self.rays[y0 : y1 + 1, x0 : x1 + 1].reshape(-1, 3)
            denom = rays @ n
            with np.errstate(divide="ignore", invalid="ignore"):
                lam = (t @ n) / denom
            X = rays * lam[:, None] - t  # tag-frame point, in camera axes
            local = X @ R  # (x, y, z) in the tag frame
            yy, zz = local[:, 1], local[:, 2]
            inside = (self.valid[y0 : y1 + 1, x0 : x1 + 1].ravel() & np.isfinite(lam) & (lam > 0)
                      & (np.abs(yy) <= border / 2) & (np.abs(zz) <= border / 2))
            if k not in self.cells:
                self.cells[k] = official_tag_cells(k)
            cells = self.cells[k]
            col = np.floor((yy + S / 2) / (S / 8)).astype(int)
            row = np.floor((S / 2 - zz) / (S / 8)).astype(int)
            in_tag = (col >= 0) & (col < 8) & (row >= 0) & (row < 8)
            val = np.full(yy.shape, 235.0)
            val[in_tag] = np.where(cells[np.clip(row[in_tag], 0, 7), np.clip(col[in_tag], 0, 7)] > 127, 235.0, 25.0)
            patch = img[y0 : y1 + 1, x0 : x1 + 1].reshape(-1)
            patch[inside] = val[inside]
            img[y0 : y1 + 1, x0 : x1 + 1] = patch.reshape(y1 - y0 + 1, x1 - x0 + 1)
        img = cv2.GaussianBlur(img, (0, 0), 0.7)
        img += rng.normal(0, 2.0, img.shape)
        return np.clip(img, 0, 255).astype(np.uint8)


def write_session(truth: Truth, out: Path, fps: float = 15.0, hold_s: float = 1.8, move_s: float = 1.0,
                  size: float = 0.1651, seed: int = 3, quality: int = 90) -> None:
    """A Rewind-format recording of the truth: every camera's frames, held still at each spot."""
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(seed)
    # Timeline of robot poses: hold at each spot, then slide (x, y, heading) to the next.
    poses = []
    t = 0.0
    for i, T in enumerate(truth.spots):
        for _ in range(int(hold_s * fps)):
            poses.append((t, T))
            t += 1 / fps
        if i + 1 < len(truth.spots):
            a, b = T, truth.spots[i + 1]
            ya, yb = g.to_rpy(a[:3, :3])[2], g.to_rpy(b[:3, :3])[2]
            dy = (yb - ya + np.pi) % (2 * np.pi) - np.pi
            m = int(move_s * fps)
            for j in range(1, m + 1):
                f = j / (m + 1)
                poses.append((t, g.planar(a[0, 3] + f * (b[0, 3] - a[0, 3]), a[1, 3] + f * (b[1, 3] - a[1, 3]), ya + f * dy)))
                t += 1 / fps
    for c, cam in truth.cameras.items():
        r = _Renderer(cam, size)
        d = out / c
        d.mkdir(exist_ok=True)
        with (d / "0000.mjpeg").open("wb") as fj, (d / "0000.csv").open("w", newline="") as fc:
            w = csv.writer(fc)
            fc.write("# frame,offset,size,width,height,jetson_us,robot_us\n")  # as the Jetson writes it
            off = 0
            for i, (tt, T) in enumerate(poses):
                img = r.render(T @ truth.mounts[c], truth.layout, rng)
                ok, jpg = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
                b = jpg.tobytes()
                fj.write(b)
                us = int(1_000_000 + tt * 1e6 + rng.uniform(0, 3000))  # cameras aren't synchronized
                w.writerow([i, off, len(b), cam.width, cam.height, us, us])
                off += len(b)
    session = {"name": "synthetic", "synthetic": True, "fps": fps,
               "settings": {"cameras": {c: {"calibration": cam.to_json()} for c, cam in truth.cameras.items()}}}
    (out / "session.json").write_text(json.dumps(session, indent=2))
    (out / "truth.json").write_text(json.dumps(truth.to_json(), indent=2))
