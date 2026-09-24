"""Writing the results: the corrected layout, the camera mounts, and a report for people."""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import date
from pathlib import Path

import numpy as np

from . import geometry as g
from .camera import Camera
from .solve import Result


def _xyzrpy(T: np.ndarray) -> dict:
    r, p, y = g.to_rpy(T[:3, :3])
    return {"x": T[0, 3], "y": T[1, 3], "z": T[2, 3], "rollDeg": np.degrees(r), "pitchDeg": np.degrees(p),
            "yawDeg": np.degrees(y)}


def _verdict(e: dict, min_obs: int) -> str:
    if e["observations"] < min_obs:
        return "seen once: kept the official pose"
    if "offsetCm" not in e:
        return "not in the layout: added"
    moved = e["offsetCm"] > max(1.0, 3 * e["sigmaRelCm"]) or e["angleDeg"] > max(0.5, 3 * e["sigmaDeg"])
    if moved:
        return "**moved**"
    if e["sigmaRelCm"] > 1.0:
        return "as drawn, but not well seen"
    return "as drawn"


def _lens_check(res: Result, cams: dict[str, Camera]) -> dict[str, dict]:
    """Fit error of views near the image centre vs near the edges, per camera. Errors that grow
    toward the edges mean the lens calibration is off there."""
    out = {}
    by = defaultdict(lambda: {"centre": [], "edge": []})
    for o, e in zip(res.used, res.obs_rms):
        cam = cams.get(o.camera)
        if cam is None:
            continue
        c = o.corners.mean(axis=0)
        r = np.hypot((c[0] - cam.cx) / (cam.width / 2), (c[1] - cam.cy) / (cam.height / 2)) / np.sqrt(2)
        if r < 0.45:
            by[o.camera]["centre"].append(e)
        elif r > 0.65:
            by[o.camera]["edge"].append(e)
    for c, d in by.items():
        rc = float(np.sqrt(np.mean(np.square(d["centre"])))) if d["centre"] else None
        re = float(np.sqrt(np.mean(np.square(d["edge"])))) if d["edge"] else None
        out[c] = {"centrePx": rc, "edgePx": re, "centreViews": len(d["centre"]), "edgeViews": len(d["edge"]),
                  "recalibrate": bool(rc is not None and re is not None and len(d["edge"]) >= 3
                                      and re > 1.0 and re > 2 * rc)}
    return out


def write(res: Result, layout_json: dict, layout: dict[int, np.ndarray], out: Path, T_robot_rig: np.ndarray | None,
          anchor_note: str, min_obs: int = 2, notes: list[str] | None = None, cams: dict[str, Camera] | None = None,
          cad: dict[str, np.ndarray] | None = None) -> dict:
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)

    # 1. Corrected layout: solved poses for tags seen at least min_obs times, the official ones otherwise.
    new = json.loads(json.dumps(layout_json))
    changed = []
    for tag in new["tags"]:
        t = tag["ID"]
        if t in res.tags and res.obs_by_tag[t] >= min_obs:
            tag["pose"] = g.to_wpilib_pose(res.tags[t])
            changed.append(t)
    have = {t["ID"] for t in new["tags"]}
    for t in sorted(set(res.tags) - have):  # seen, but not in the official layout
        if res.obs_by_tag[t] >= min_obs:
            new["tags"].append({"ID": t, "pose": g.to_wpilib_pose(res.tags[t])})
            changed.append(t)
    (out / "corrected-layout.json").write_text(json.dumps(new, indent=2))

    # 2. Mounts
    mounts = {}
    for c, T in res.cameras.items():
        m = {"rigFrame": _xyzrpy(T), "sigma": dict(zip(["x", "y", "z", "rollDeg", "pitchDeg", "yawDeg"],
                                                        [float(v) for v in res.camera_sigma[c]]))}
        if T_robot_rig is not None:
            m["robotToCamera"] = _xyzrpy(T_robot_rig @ T)
            if cad and c in cad:
                m["cad"] = _xyzrpy(cad[c])
                m["minusCad"] = {k: m["robotToCamera"][k] - m["cad"][k] for k in m["cad"]}
                m["minusCad"]["yawDeg"] = (m["minusCad"]["yawDeg"] + 180) % 360 - 180
        mounts[c] = m
    (out / "mounts.json").write_text(json.dumps(mounts, indent=2, default=float))

    # 3. Tag offsets
    tags = {}
    for t, T in sorted(res.tags.items()):
        L = layout.get(t)
        entry = {"observations": res.obs_by_tag[t], "rmsPx": res.rms_by_tag.get(t),
                 "sigmaCm": res.tag_sigma[t][0] * 100, "sigmaRelCm": res.tag_rel_sigma[t] * 100,
                 "sigmaDeg": res.tag_sigma[t][1], "solvedPose": g.to_wpilib_pose(T)}
        if L is not None:
            d = T[:3, 3] - L[:3, 3]
            entry.update({"dxCm": d[0] * 100, "dyCm": d[1] * 100, "dzCm": d[2] * 100,
                          "offsetCm": float(np.linalg.norm(d) * 100),
                          "angleDeg": np.degrees(g.angle_between(L[:3, :3], T[:3, :3]))})
        entry["verdict"] = _verdict(entry, min_obs).replace("**", "")
        tags[t] = entry
    lens = _lens_check(res, cams or {})
    summary = {"referenceCamera": res.ref_camera, "spots": len(res.segments), "observations": len(res.used),
               "dropped": len(res.dropped), "rmsPxByCamera": res.rms_by_camera, "tags": tags, "mounts": mounts,
               "anchor": anchor_note, "correctedTags": changed, "lensCheck": lens, "notes": notes or [],
               "alignment": res.alignment}
    (out / "results.json").write_text(json.dumps(summary, indent=2, default=float))
    (out / "report.md").write_text(_markdown(res, summary, layout, min_obs))
    return summary


def _java(mounts: dict) -> list[str]:
    L = ["```java", f"// fieldcal {date.today().isoformat()}: robotToCamera for each camera"]
    for c, m in mounts.items():
        f = m["robotToCamera"]
        L.append(f"Transform3d {c[0].lower() + c[1:]}ToCamera = new Transform3d(")
        L.append(f"    new Translation3d({f['x']:.4f}, {f['y']:.4f}, {f['z']:.4f}),")
        L.append(f"    new Rotation3d(Units.degreesToRadians({f['rollDeg']:.2f}), "
                 f"Units.degreesToRadians({f['pitchDeg']:.2f}), Units.degreesToRadians({f['yawDeg']:.2f})));")
    L.append("```")
    return L


def _markdown(res: Result, s: dict, layout, min_obs: int) -> str:
    L = []
    L.append("# Field calibration report\n")
    L.append(f"- Spots (still stretches) used: **{s['spots']}**; observations: {s['observations']} "
             f"({s['dropped']} dropped as outliers)")
    L.append(f"- Reference camera: {s['referenceCamera']}. {s['anchor']}")
    for n in s["notes"]:
        L.append(f"- Note: {n}")
    L.append("\n## What to do with it\n")
    L.append("- **corrected-layout.json**: the field as it is. Upload it to PhotonVision (Settings → AprilTag "
             "field layout) and load it in robot code (`new AprilTagFieldLayout(path)`), so both agree.")
    anchored = "robotToCamera" in next(iter(s["mounts"].values()), {})
    if anchored:
        L.append("- **Camera mounts** below: copy into robot code (and PhotonVision's mount, if you use it). "
                 "Check them against CAD first: a big difference is either a bent mount or a wrong CAD number.")
    else:
        L.append("- **Camera mounts**: height, pitch and roll below are real. x, y and yaw need an anchor "
                 "(`--reference-spot`, `--anchor-camera` or `--cad`) before they go into robot code.")

    rms = s["rmsPxByCamera"]
    med = float(np.median(list(rms.values()))) if rms else 1.0
    L.append("\n## Cameras\n")
    L.append("| Camera | Fit (px RMS) | Noise factor | Height (m) | Pitch (°) | Roll (°) | x (m) | y (m) | Yaw (°) |")
    L.append("|---|---|---|---|---|---|---|---|---|")
    for c, m in s["mounts"].items():
        f = m.get("robotToCamera", m["rigFrame"])
        sg = m["sigma"]
        L.append(f"| {c} | {rms.get(c, float('nan')):.2f} | {rms.get(c, med) / med:.2f} | {f['z']:.3f} ± {sg['z']:.3f} | "
                 f"{f['pitchDeg']:.2f} ± {sg['pitchDeg']:.2f} | {f['rollDeg']:.2f} ± {sg['rollDeg']:.2f} | "
                 f"{f['x']:.3f} | {f['y']:.3f} | {f['yawDeg']:.2f} |")
    if not anchored:
        L.append("\nx, y and yaw are relative to the reference camera. Height, pitch and roll are the real mounts, "
                 "with the robot level on the floor.")
    L.append("\nPitch follows WPILib: negative = tilted up. Noise factor: this camera's fit error over the median "
             "camera's; scale its vision std devs by it.")
    if any("cad" in m for m in s["mounts"].values()):
        L.append("\n### Against CAD\n")
        L.append("| Camera | dx (cm) | dy (cm) | dz (cm) | dRoll (°) | dPitch (°) | dYaw (°) |")
        L.append("|---|---|---|---|---|---|---|")
        for c, m in s["mounts"].items():
            d = m.get("minusCad")
            if d:
                L.append(f"| {c} | {d['x'] * 100:.1f} | {d['y'] * 100:.1f} | {d['z'] * 100:.1f} | {d['rollDeg']:.2f} | "
                         f"{d['pitchDeg']:.2f} | {d['yawDeg']:.2f} |")
        L.append("\nx, y and yaw were anchored to CAD as a whole, so these show how the cameras disagree with CAD "
                 "relative to each other; height, pitch and roll are absolute.")
    lens = s["lensCheck"]
    if lens:
        L.append("\n### Lens calibration check\n")
        L.append("| Camera | Fit near the centre (px) | Fit near the edges (px) | |")
        L.append("|---|---|---|---|")
        for c, d in lens.items():
            fmt = lambda v, n: f"{v:.2f} ({n} views)" if v is not None else "no views"
            L.append(f"| {c} | {fmt(d['centrePx'], d['centreViews'])} | {fmt(d['edgePx'], d['edgeViews'])} | "
                     f"{'**recalibrate**' if d['recalibrate'] else ''} |")
    if anchored:
        L.append("\n### For robot code\n")
        L += _java(s["mounts"])

    L.append("\n## Tags\n")
    al = s.get("alignment") or {}
    if al.get("tagsUsed"):
        L.append(f"The map was lined up with the official layout on the tags that agree with each other: "
                 f"{', '.join(map(str, sorted(al['tagsUsed'])))}"
                 + (f"; not used for that (they disagree, so they probably moved): "
                    f"{', '.join(map(str, sorted(al['tagsIgnored'])))}" if al.get("tagsIgnored") else "")
                 + ". If most of the tags that moved are on one field element, it's probably the element "
                 "that's out of place.\n")
    L.append("Offsets are the solved position minus the official layout's, in the field frame. ± is how well "
             "the tag is known relative to the other tags. **Moved**: more than 1 cm (and 3 ±) or 0.5° off.\n")
    L.append("| Tag | Seen | Fit (px) | dx (cm) | dy (cm) | dz (cm) | Offset (cm) | Angle (°) | Verdict |")
    L.append("|---|---|---|---|---|---|---|---|---|")
    for t, e in s["tags"].items():
        v = _verdict(e, min_obs)
        if "offsetCm" not in e:
            L.append(f"| {t} | {e['observations']} | {e['rmsPx']:.2f} | | | | | | {v} |")
            continue
        L.append(f"| {t} | {e['observations']} | {e['rmsPx']:.2f} | {e['dxCm']:.1f} | {e['dyCm']:.1f} | {e['dzCm']:.1f} | "
                 f"{e['offsetCm']:.1f} ± {e['sigmaRelCm']:.1f} | {e['angleDeg']:.2f} ± {e['sigmaDeg']:.2f} | {v} |")
    unseen = sorted(set(layout) - set(res.tags))
    if unseen:
        L.append(f"\nNot seen (kept from the official layout): {', '.join(map(str, unseen))}")
    once = [t for t, e in s["tags"].items() if e["observations"] < min_obs]
    if once:
        L.append(f"\nSeen from only one spot, so kept at the official pose (the solve's guess is in results.json): "
                 f"{', '.join(map(str, once))}. Another spot facing them would fix that.")
    worst = sorted(res.rms_by_segment.items(), key=lambda kv: -kv[1])[:3]
    if worst:
        L.append("\n## Spots with the largest fit error\n")
        L.append("A spot that fits much worse than the others may have had the robot tilted (on a bump) or "
                 "moving.\n")
        for sp, e in worst:
            L.append(f"- spot {sp}: {e:.2f} px")
    if res.dropped:
        L.append(f"\n{len(res.dropped)} observations were dropped as outliers (misdetections, a tag partly hidden, "
                 "or a tag at the very edge of the image):\n")
        for o, e in sorted(res.dropped, key=lambda d: -d[1])[:10]:
            L.append(f"- spot {o.segment}, {o.camera}, tag {o.tag}: {e:.1f} px")
    return "\n".join(L) + "\n"
