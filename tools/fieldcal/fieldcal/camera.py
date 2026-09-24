"""Camera intrinsics and projection (OpenCV's rational model, 8 coefficients, as PhotonVision's
mrcal/OpenCV calibration produces)."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class Camera:
    name: str
    width: int
    height: int
    fx: float
    fy: float
    cx: float
    cy: float
    dist: np.ndarray = field(default_factory=lambda: np.zeros(8))  # k1 k2 p1 p2 k3 k4 k5 k6
    lens_model: str | None = None

    @property
    def K(self) -> np.ndarray:
        return np.array([[self.fx, 0, self.cx], [0, self.fy, self.cy], [0, 0, 1.0]])

    def dist8(self) -> np.ndarray:
        d = np.zeros(8)
        d[: min(8, len(self.dist))] = np.asarray(self.dist, float)[:8]
        return d

    def max_radius(self) -> float:
        """How far off-axis (tan of the angle) the distortion model is valid. A fitted polynomial
        turns back past some radius, and a point beyond that lands back inside the image: a tag at
        55° off-axis would appear to be at 40°. Found by walking out until the distorted radius stops
        growing (cached)."""
        if getattr(self, "_max_r", None) is None:
            k1, k2, _, _, k3, k4, k5, k6 = self.dist8()
            r = np.linspace(0, 5, 5001)
            r2 = r * r
            rd = r * (1 + k1 * r2 + k2 * r2**2 + k3 * r2**3) / (1 + k4 * r2 + k5 * r2**2 + k6 * r2**3)
            turn = np.flatnonzero(np.diff(rd) <= 0)
            self._max_r = float(r[turn[0]]) if len(turn) else np.inf
        return self._max_r

    def project(self, P: np.ndarray) -> np.ndarray:
        """Points in the OpenCV camera frame (N x 3) -> pixels (N x 2). Points behind the camera, or
        beyond max_radius(), get NaN."""
        P = np.asarray(P, float)
        z = P[:, 2]
        with np.errstate(divide="ignore", invalid="ignore"):
            x = P[:, 0] / z
            y = P[:, 1] / z
        k1, k2, p1, p2, k3, k4, k5, k6 = self.dist8()
        r2 = x * x + y * y
        r4 = r2 * r2
        r6 = r4 * r2
        radial = (1 + k1 * r2 + k2 * r4 + k3 * r6) / (1 + k4 * r2 + k5 * r4 + k6 * r6)
        xd = x * radial + 2 * p1 * x * y + p2 * (r2 + 2 * x * x)
        yd = y * radial + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y
        uv = np.column_stack([self.fx * xd + self.cx, self.fy * yd + self.cy])
        uv[(z <= 1e-6) | ~(r2 < self.max_radius() ** 2)] = np.nan
        return uv

    def in_image(self, uv: np.ndarray, margin: float = 0.0) -> np.ndarray:
        return (
            np.isfinite(uv).all(axis=1)
            & (uv[:, 0] >= margin)
            & (uv[:, 0] <= self.width - 1 - margin)
            & (uv[:, 1] >= margin)
            & (uv[:, 1] <= self.height - 1 - margin)
        )

    @staticmethod
    def from_settings(name: str, cal: dict) -> "Camera":
        """From the 'calibration' block of Rewind's session.json settings (photonvision-24), or a
        PhotonVision calibration JSON (the UI's export, or one of photon.sqlite's calibrations)."""
        if "cameraIntrinsics" in cal:
            k = cal["cameraIntrinsics"]["data"]
            r = cal["resolution"]
            return Camera(name, int(r["width"]), int(r["height"]), k[0], k[4], k[2], k[5],
                          np.array(cal.get("distCoeffs", {}).get("data", [])), cal.get("lensmodel"))
        w, h = (int(v) for v in cal["resolution"].split("x"))
        return Camera(name, w, h, cal["fx"], cal["fy"], cal["cx"], cal["cy"], np.array(cal.get("distCoeffs", [])),
                      cal.get("lensModel"))

    def check(self) -> list[str]:
        """Problems with using this calibration here."""
        out = []
        if self.lens_model and "OPENCV" not in self.lens_model.upper():
            out.append(f"{self.name}: lens model {self.lens_model} isn't OpenCV's; this tool only models OpenCV's.")
        frac = self.coverage()
        if frac < 0.995:
            out.append(f"{self.name}: the lens calibration only reaches {frac:.1%} of the image (it bends back past "
                       f"{np.degrees(np.arctan(self.max_radius())):.0f}° off-axis). Tags in the far corners can't be "
                       "used; a calibration with board views right into the corners would fix it.")
        return out

    def coverage(self) -> float:
        """Fraction of the image the distortion model can reach at all."""
        u, v = np.meshgrid(np.linspace(0, self.width - 1, 64), np.linspace(0, self.height - 1, 40))
        pts = np.stack([u.ravel(), v.ravel()], axis=1)
        und = self.undistort(pts, iterations=60)
        back = self.project(np.c_[und, np.ones(len(und))])
        return float(np.mean(np.linalg.norm(back - pts, axis=1) < 0.5))

    def undistort(self, uv: np.ndarray, iterations: int = 40) -> np.ndarray:
        """Pixels (N x 2) -> normalised, undistorted image coordinates (N x 2)."""
        import cv2

        pts = np.asarray(uv, np.float64).reshape(-1, 1, 2)
        crit = (cv2.TERM_CRITERIA_COUNT | cv2.TERM_CRITERIA_EPS, iterations, 1e-9)
        if hasattr(cv2, "undistortPointsIter"):  # OpenCV 4 (the Jetson's 4.8)
            und = cv2.undistortPointsIter(pts, self.K, self.dist8(), None, None, crit)
        else:  # OpenCV 5 folded it into undistortPoints
            und = cv2.undistortPoints(pts, self.K, self.dist8(), criteria=crit)
        return und.reshape(-1, 2)

    def scaled_to(self, width: int, height: int) -> "Camera":
        """The same lens at another resolution with the same aspect ratio (a binned mode)."""
        sx, sy = width / self.width, height / self.height
        return Camera(self.name, width, height, self.fx * sx, self.fy * sy, (self.cx + 0.5) * sx - 0.5,
                      (self.cy + 0.5) * sy - 0.5, self.dist.copy(), self.lens_model)

    def to_json(self) -> dict:
        return {
            "resolution": f"{self.width}x{self.height}",
            "fx": self.fx,
            "fy": self.fy,
            "cx": self.cx,
            "cy": self.cy,
            "distCoeffs": [float(v) for v in self.dist8()],
        }
