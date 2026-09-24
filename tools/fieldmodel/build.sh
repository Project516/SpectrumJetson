#!/bin/bash
# Builds assets/field-models/2026-rebuilt.glb from FIRST's official 2026 field CAD (the STEP linked
# from https://www.firstinspires.org/resources/library/frc/playing-field). About a minute.
# Needs the fieldcal venv plus cascadio and trimesh, and gltfpack (npm) in ~/build/tools/gltfpack.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
WORK=$HOME/build/fieldcad
STEP_URL=https://firstfrc.blob.core.windows.net/frc2026/FieldAssets/FE-2026-rev-rebuilt-playing-field.step
STEP_SHA256=2ad90e42f2c2db0fab5b22bb65aa0851089e414d568d4ebd127624fa230c7671
PY=${FIELDCAL_PYTHON:-$HOME/build/fieldcal-venv/bin/python}
GLTFPACK=${GLTFPACK:-$HOME/build/tools/gltfpack/node_modules/.bin/gltfpack}
mkdir -p "$WORK"
STEP=$WORK/$(basename "$STEP_URL")
if [[ ! -f $STEP ]]; then
  echo "Downloading $STEP_URL (36 MB)"
  curl -fsSL -o "$STEP" "$STEP_URL"
fi
echo "$STEP_SHA256  $STEP" | sha256sum -c --quiet || { echo "The STEP changed upstream: check it, then update STEP_SHA256" >&2; exit 1; }
PATH=$HOME/build/tools/node/bin:$PATH "$PY" "$HERE/build_field_model.py" "$STEP" "$REPO/assets/field-models/2026-rebuilt.glb" \
  --gltfpack "$GLTFPACK" "$@"
