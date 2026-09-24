"""The 3D field model for PhotonVision's Field Calibration page, from FIRST's official field CAD.

    tools/fieldmodel/build.sh        (downloads the STEP once, then runs this)

1. FIRST's STEP (the welded field) -> glTF with OpenCASCADE (cascadio), coarsely tessellated.
2. Every part is sorted into its field element by the CAD's assembly names (GE-26300 Hub, GE-26200
   Trench, ...). The FUEL, the fuel counter inside the hubs, and parts under 3 cm (fasteners) are
   dropped.
3. CAD coordinates (field centre, z up) -> WPILib field coordinates. The rotation comes from
   which hub carries the blue parts; the shift is fitted to WPILib's welded 2026 tag layout.
4. Each element is stored in its own frame, defined by the tags mounted on it. The node is
   named ``kind@tag,tag,...``, and the viewer places it where those tags are in the layout in use.
   So the model fits the AndyMark and welded fields, and after a calibration each element sits
   where its tags were found.
   The perimeter is split into its four sides, anchored to the field's edges instead of to tags:
   ``@x0`` (blue alliance wall, with its driver stations and depot), ``@xL`` (red), ``@y0`` and
   ``@yW`` (guardrails). The viewer puts them at the layout's field length and width. FIRST's CAD is
   the welded field, and AndyMark doesn't publish CAD for its perimeter (am-2800). So on an AndyMark
   layout the welded rails stand in, moved to the AndyMark field's size (2.3 cm shorter, 2.6 cm
   narrower). The carpet is fixed (``@``).
5. Meshes are merged per element and colour, then simplified and compressed by gltfpack.

Needs: cascadio, trimesh, numpy, robotpy-apriltag (for WPILib's layout), and gltfpack.
"""

from __future__ import annotations

import argparse
import collections
import json
import math
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
import trimesh

# Which tags sit on which element (2026 REBUILT); the first is the element's reference tag.
ANCHORS = {
    "hub": [[18, 19, 20, 21, 24, 25, 26, 27], [2, 3, 4, 5, 8, 9, 10, 11]],
    "trench": [[17, 28], [22, 23], [1, 12], [6, 7]],
    "tower": [[31, 32], [15, 16]],
    "outpost": [[29, 30], [13, 14]],
}
ELEMENT = [
    (r"^GE-26300: Hub", "hub"),
    (r"^GE-26200: Trench", "trench"),
    (r"^GE-26100: Bump", "bump"),
    (r"^GE-26500: Tower", "tower"),
    (r"^GE-26000: Outpost", "outpost"),
    (r"^GE-26600: Depot", "depot"),
    (r"^GE-26400: Fuel Counter", None),  # inside the hubs: not visible
    (r"^FE-2026-01: Playing Field Carpet", "carpet"),
    (r"^FE-2026-02: Welded Perimeter", "perimeter"),
]
MIN_PART_M = 0.03


def welded_layout():
    import robotpy_apriltag as rat

    lay = rat.AprilTagFieldLayout.loadField(rat.AprilTagField.k2026RebuiltWelded)
    tags = {}
    for t in lay.getTags():
        p = t.pose
        tags[t.ID] = (p.X(), p.Y(), p.Z(), p.rotation().Z())
    return tags, lay.getFieldLength(), lay.getFieldWidth()


def frame(tags, ids):
    """4x4 field-from-element: origin at the tags' centroid on the floor, x along the first tag's facing."""
    pts = np.array([tags[i][:2] for i in ids])
    c = pts.mean(axis=0)
    yaw = tags[ids[0]][3]
    T = np.eye(4)
    T[:2, :2] = [[math.cos(yaw), -math.sin(yaw)], [math.sin(yaw), math.cos(yaw)]]
    T[:2, 3] = c
    return T


def classify(scene):
    parent = {e[1]: e[0] for e in scene.graph.to_edgelist()}

    def element(node):
        n = node
        while True:
            name = re.sub(r"_\d+$", "", str(n))
            for pat, kind in ELEMENT:
                if re.match(pat, name):
                    return name, kind
            if n not in parent:
                return None, None
            n = parent[n]

    out = collections.defaultdict(list)  # instance name -> [(mesh in CAD world, colour)]
    kinds = {}
    dropped = collections.Counter()
    for node in scene.graph.nodes_geometry:
        tr, gname = scene.graph[node]
        inst, kind = element(node)
        if kind is None:
            dropped["fuel and other" if inst is None else inst] += 1
            continue
        m = scene.geometry[gname]
        if np.linalg.norm(m.extents) < MIN_PART_M and kind not in ("carpet",):
            dropped["parts < 3 cm"] += 1
            continue
        mm = m.copy()
        mm.apply_transform(tr)
        colour = tuple(int(v) for v in np.round(getattr(m.visual.material, "baseColorFactor", [200, 200, 200, 255])))
        out[inst].append((mm, colour))
        kinds[inst] = kind
    return out, kinds, dropped


def _add(scene, parts, label, inst, F, M):
    """One node per colour, named ``label#instance#n``, placed at F with the geometry in F's frame."""
    to_local = np.linalg.inv(F) @ M
    by_colour = collections.defaultdict(list)
    for m, col in parts:
        by_colour[col].append(m)
    for j, (col, ms) in enumerate(sorted(by_colour.items())):
        mesh = trimesh.util.concatenate(ms)
        mesh.apply_transform(to_local)
        mat = trimesh.visual.material.PBRMaterial(baseColorFactor=list(col), metallicFactor=0.0, roughnessFactor=0.85,
                                                  alphaMode="BLEND" if col[3] < 250 else "OPAQUE", doubleSided=True)
        mesh.visual = trimesh.visual.TextureVisuals(material=mat)
        scene.add_geometry(mesh, node_name=f"{label}#{inst}#{j}", geom_name=f"{inst}#{j}", transform=F)


def check_tags(scene, M, tags):
    """Distance of each AprilTag part in the CAD (after M) from WPILib's position for it."""
    parent = {e[1]: e[0] for e in scene.graph.to_edgelist()}
    centres = collections.defaultdict(list)
    for node in scene.graph.nodes_geometry:
        n = node
        while True:
            m = re.match(r"^FE-00083-ID(\d+): AprilTag, ID", str(n))
            if m or n not in parent:
                break
            n = parent[n]
        if not m:
            continue
        tr, g = scene.graph[node]
        mesh = scene.geometry[g].copy()
        mesh.apply_transform(tr)
        centres[int(m.group(1))].append(mesh.bounds.mean(axis=0))
    return {t: float(np.linalg.norm((M @ np.r_[np.mean(c, axis=0), 1])[:3] - np.array(tags[t][:3])))
            for t, c in centres.items() if t in tags}


def blue_share(parts):
    blue = sum(len(m.faces) for m, c in parts if c[2] > 200 and c[0] < 60)
    red = sum(len(m.faces) for m, c in parts if c[0] > 200 and c[2] < 60)
    return blue - red


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("step", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--work", type=Path, default=Path.home() / "build" / "fieldcad")
    ap.add_argument("--gltfpack", default="gltfpack")
    ap.add_argument("--simplify", type=float, default=0.12, help="gltfpack -si ratio")
    a = ap.parse_args(argv)
    a.work.mkdir(parents=True, exist_ok=True)

    raw = a.work / (a.step.stem + "-coarse.glb")
    if not raw.exists() or raw.stat().st_mtime < a.step.stat().st_mtime:
        import cascadio

        print("Tessellating the STEP...", file=sys.stderr)
        cascadio.step_to_glb(str(a.step), str(raw), tol_linear=0.01, tol_angular=0.8, merge_primitives=True,
                             use_parallel=True, include_materials=True)
    scene = trimesh.load(raw, force="scene")
    parts, kinds, dropped = classify(scene)
    print(f"{len(parts)} element instances; dropped: {dict(dropped)}", file=sys.stderr)

    tags, L, W = welded_layout()
    # CAD -> field. Rotation: the blue hub must end up at x < L/2.
    hubs = [i for i, k in kinds.items() if k == "hub"]
    centre = {i: trimesh.util.concatenate([m for m, _ in parts[i]]).bounds.mean(axis=0) for i in parts}
    blue_hub = max(hubs, key=lambda i: blue_share(parts[i]))
    R = np.eye(4) if centre[blue_hub][0] < 0 else np.diag([-1.0, -1.0, 1.0, 1.0])
    # Shift: hub centres against the hubs' tag centroids.
    want = {k: np.array([np.mean([tags[t][0] for t in ids]), np.mean([tags[t][1] for t in ids])]) for k, ids in
            zip(("blue", "red"), ANCHORS["hub"])}
    got = {"blue": (R @ np.r_[centre[blue_hub], 1])[:2],
           "red": (R @ np.r_[centre[[h for h in hubs if h != blue_hub][0]], 1])[:2]}
    shift = np.mean([want[k] - got[k] for k in want], axis=0)
    M = np.eye(4)
    M[:2, 3] = shift
    M = M @ R
    # Check: the CAD's own AprilTag parts (FE-00083-IDnn) against WPILib's welded layout.
    tag_err = check_tags(scene, M, tags)
    print(f"CAD -> field: rotated {'180 deg' if R[0, 0] < 0 else '0'}, shifted {np.round(shift, 4)}; the CAD's "
          f"{len(tag_err)} tags are within {max(tag_err.values()) * 100:.2f} cm of WPILib's welded layout", file=sys.stderr)
    if max(tag_err.values()) > 0.02:
        print("The CAD and WPILib's layout disagree by more than 2 cm: check the alignment", file=sys.stderr)
        return 1

    # A trench assembly is both trenches of one alliance (one per guardrail): split it by side.
    for inst in [i for i, k in kinds.items() if k == "trench"]:
        sides = collections.defaultdict(list)
        for m, col in parts.pop(inst):
            y = (M @ np.r_[m.bounds.mean(axis=0), 1])[1]
            sides["low" if y < W / 2 else "high"].append((m, col))
        del kinds[inst]
        for side, ps in sides.items():
            parts[f"{inst} {side}"] = ps
            kinds[f"{inst} {side}"] = "trench"
            centre[f"{inst} {side}"] = trimesh.util.concatenate([m for m, _ in ps]).bounds.mean(axis=0)

    # The perimeter (and the depots on the alliance walls): four sides, each anchored to a field edge.
    edge_parts = collections.defaultdict(list)
    for inst in [i for i, k in kinds.items() if k in ("perimeter", "depot")]:
        for m, col in parts.pop(inst):
            x, y = (M @ np.r_[m.bounds.mean(axis=0), 1])[:2]
            if x < 1.5:
                edge = "x0"
            elif x > L - 1.5:
                edge = "xL"
            else:
                edge = "y0" if y < W / 2 else "yW"
            edge_parts[edge].append((m, col))
        del kinds[inst]
    edge_frame = {"x0": (0.0, 0.0), "xL": (L, 0.0), "y0": (0.0, 0.0), "yW": (0.0, W)}
    for edge, ps in edge_parts.items():
        name = f"perimeter {edge}"
        parts[name] = ps
        kinds[name] = "perimeter"
        centre[name] = None

    # Each instance: its anchor tags (nearest group of its kind), and its own frame.
    out = trimesh.Scene()
    report = {}
    for inst, kind in sorted(kinds.items()):
        anchor = []
        if kind == "perimeter":
            edge = inst.split()[-1]
            F = np.eye(4)
            F[:2, 3] = edge_frame[edge]
            label = f"perimeter@{edge}"
            _add(out, parts[inst], label, inst, F, M)
            report[inst] = {"kind": kind, "anchor": edge, "triangles": int(sum(len(m.faces) for m, _ in parts[inst]))}
            continue
        c = (M @ np.r_[centre[inst], 1])[:2]
        if kind in ANCHORS:
            groups = ANCHORS[kind]
            anchor = min(groups, key=lambda ids: np.linalg.norm(np.mean([tags[t][:2] for t in ids], axis=0) - c))
        elif kind == "bump":  # rides with the nearest hub
            anchor = min(ANCHORS["hub"], key=lambda ids: np.linalg.norm(np.mean([tags[t][:2] for t in ids], axis=0) - c))
        F = frame(tags, anchor) if anchor else np.eye(4)
        _add(out, parts[inst], f"{kind}@{','.join(map(str, anchor))}", inst, F, M)
        report[inst] = {"kind": kind, "anchor": anchor, "triangles": int(sum(len(m.faces) for m, _ in parts[inst]))}
    proc = a.work / "field-processed.glb"
    out.export(proc)
    tri = sum(r["triangles"] for r in report.values())
    print(f"{tri / 1e6:.2f} M triangles before simplifying", file=sys.stderr)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([a.gltfpack, "-i", str(proc), "-o", str(a.out), "-kn", "-km", "-cc", "-si", str(a.simplify)],
                   check=True)
    print(f"Wrote {a.out} ({a.out.stat().st_size / 1e6:.1f} MB)", file=sys.stderr)
    (a.out.with_suffix(".json")).write_text(json.dumps(
        {"source": a.step.name, "fieldLength": L, "fieldWidth": W, "cadToField": M.tolist(),
         "tagCheckMaxCm": round(max(tag_err.values()) * 100, 2), "elements": report}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
