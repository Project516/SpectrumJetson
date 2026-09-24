# fieldmodel: the 3D field for the Field Calibration page

Builds `assets/field-models/2026-rebuilt.glb`, the real 2026 REBUILT field in PhotonVision's Field
Calibration page (3D view). The source is *FIRST*'s official field CAD, the STEP linked from the
[Playing Field page](https://www.firstinspires.org/resources/library/frc/playing-field). The jar
build (`scripts/host/03-build-photonvision-fork.sh`) copies the model into PhotonVision's web UI,
which serves it at `fieldmodels/`.

```bash
tools/fieldmodel/build.sh
```

About a minute. The first run downloads the STEP (36 MB) to `~/build/fieldcad` and checks its
SHA-256. Needs:
- the fieldcal venv with `cascadio` and `trimesh` (`~/build/fieldcal-venv/bin/pip install cascadio trimesh`);
- gltfpack (`npm install gltfpack` in `~/build/tools/gltfpack`).

## What it does

1. **Tessellates** the STEP with OpenCASCADE (cascadio): 1 cm and about 45° tolerance, keeping
   the CAD's colours.
2. **Sorts every part into its field element** by the CAD's assembly names:
   - GE-26300 Hub, GE-26200 Trench, GE-26100 Bump, GE-26500 Tower, GE-26000 Outpost, GE-26600 Depot;
   - FE-2026-01 Carpet and FE-2026-02 Welded Perimeter.

   Dropped: the FUEL (114 of the 176 million triangles), the fuel counter inside the hubs, and
   every part under 3 cm (fasteners).
3. **CAD to WPILib's field frame.** The CAD's origin is the field centre with z up. The blue parts
   say which way round it goes (a 180° turn), and the shift is fitted to WPILib's welded layout.
   - **Check:** every AprilTag part in the CAD (FE-00083-IDnn) is within **0.33 cm** of WPILib's
     welded position for that tag (the vinyl's thickness). The build fails over 2 cm.
4. **Each element in its own frame, anchored to its tags.** Every node is named `kind@anchor#...`.
   The viewer (`lib/FieldModel.ts` in patch 30) moves each node to its anchor in the layout in use:
   - **`hub@18,19,…`** (also trench, tower, outpost, and the bumps with their hub): the element goes
     to its tags' centroid, turned to its first tag. So the model fits the AndyMark and welded
     layouts, and after a field calibration each element sits where its tags were found.
   - **`perimeter@x0`, `@xL`, `@y0`, `@yW`:** the perimeter's four sides. The alliance walls, with
     their driver stations and depots, and the two guardrails go to the layout's field length and
     width.
   - **`carpet@`:** fixed.
5. **Simplified and compressed** with gltfpack (meshopt): from 9.3 million to about 1 million
   triangles, 2.1 MB.

**Checked:** placed with WPILib's welded layout, every element lands where the build put it (to
0.001 mm and 0.001°). With the AndyMark layout, the elements move 1.6–3.6 cm to AndyMark's tag
positions, the red wall 2.3 cm and the far guardrail 2.6 cm.

## The AndyMark field

*FIRST*'s CAD is the welded field, and AndyMark doesn't publish CAD for its perimeter (am-2800;
only an assembly PDF). On an AndyMark layout:
- **Game elements:** the same *FIRST* CAD, placed by AndyMark's tag positions.
- **Perimeter:** the welded rails stand in, moved to the AndyMark field's size (16.518 × 8.043 m
  against 16.541 × 8.069 m). The rails themselves look different on a real AndyMark field.

If AndyMark CAD turns up, it would replace the four `perimeter@` groups.

## Terms

© *FIRST*. *FIRST* publishes the CAD for teams but states no license. AdvantageScope redistributes
field models converted from the same CAD in the same way. This is also listed in the README's
credits.

## Files

- `build_field_model.py`: the conversion.
- `build.sh`: download (pinned SHA-256) and run.
- The output, `assets/field-models/2026-rebuilt.glb`, and `2026-rebuilt.json`: the CAD-to-field
  transform, the tag check, and each element's anchor and triangle count.
