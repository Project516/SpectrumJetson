"""Poses and frames for field calibration.

Conventions (checked against WPILib's AprilTag detector and pose estimator, see tags.py):

* Field, robot and tag frames are WPILib's NWU: x forward, y left, z up. A tag's +x points out of
  its face, toward whoever is looking at it.
* Cameras are modelled in OpenCV's frame (x right, y down, z forward) for projection. Mounts are
  reported in WPILib's camera frame (x forward, y left, z up), like robotToCamera.
* ``T_a_b`` is a 4x4 matrix that maps points in frame b into frame a.
"""

from __future__ import annotations

import math

import numpy as np
from scipy.spatial.transform import Rotation

# Points in the WPILib (NWU) camera frame -> OpenCV camera frame.
NWU_TO_CV = np.array([[0.0, -1.0, 0.0], [0.0, 0.0, -1.0], [1.0, 0.0, 0.0]])


def make(R: np.ndarray, t) -> np.ndarray:
    T = np.eye(4)
    T[:3, :3] = R
    T[:3, 3] = np.asarray(t, float)
    return T


def inv(T: np.ndarray) -> np.ndarray:
    R, t = T[:3, :3], T[:3, 3]
    return make(R.T, -R.T @ t)


def from_rvec(rvec, t) -> np.ndarray:
    return make(Rotation.from_rotvec(np.asarray(rvec, float)).as_matrix(), t)


def to_rvec(T: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    return Rotation.from_matrix(T[:3, :3]).as_rotvec(), T[:3, 3].copy()


def rpy(roll: float, pitch: float, yaw: float) -> np.ndarray:
    """WPILib Rotation3d(roll, pitch, yaw): extrinsic X, Y, Z (radians)."""
    return Rotation.from_euler("xyz", [roll, pitch, yaw]).as_matrix()


def to_rpy(R: np.ndarray) -> tuple[float, float, float]:
    r, p, y = Rotation.from_matrix(R).as_euler("xyz")
    return float(r), float(p), float(y)


def planar(x: float, y: float, yaw: float) -> np.ndarray:
    return make(rpy(0.0, 0.0, yaw), [x, y, 0.0])


def cv_to_nwu(T_x_camcv: np.ndarray) -> np.ndarray:
    """A camera pose with the camera in OpenCV axes -> the same pose in WPILib camera axes."""
    return T_x_camcv @ make(NWU_TO_CV, [0, 0, 0])


def nwu_to_cv(T_x_camnwu: np.ndarray) -> np.ndarray:
    return T_x_camnwu @ make(NWU_TO_CV.T, [0, 0, 0])


def from_wpilib_pose(pose: dict) -> np.ndarray:
    """A WPILib layout JSON pose {translation: {x,y,z}, rotation: {quaternion: {W,X,Y,Z}}}."""
    t = pose["translation"]
    q = pose["rotation"]["quaternion"]
    R = Rotation.from_quat([q["X"], q["Y"], q["Z"], q["W"]]).as_matrix()
    return make(R, [t["x"], t["y"], t["z"]])


def to_wpilib_pose(T: np.ndarray) -> dict:
    x, y, z, w = Rotation.from_matrix(T[:3, :3]).as_quat()
    return {
        "translation": {"x": float(T[0, 3]), "y": float(T[1, 3]), "z": float(T[2, 3])},
        "rotation": {"quaternion": {"W": float(w), "X": float(x), "Y": float(y), "Z": float(z)}},
    }


def mean_pose(Ts: list[np.ndarray]) -> np.ndarray:
    """Average of nearby poses: mean translation, chordal mean rotation."""
    Rm = Rotation.from_matrix(np.array([T[:3, :3] for T in Ts])).mean().as_matrix()
    return make(Rm, np.mean([T[:3, 3] for T in Ts], axis=0))


def angle_between(Ra: np.ndarray, Rb: np.ndarray) -> float:
    """Rotation angle (radians) between two rotations."""
    return float(np.linalg.norm(Rotation.from_matrix(Ra.T @ Rb).as_rotvec()))


def deg(x: float) -> float:
    return math.degrees(x)
