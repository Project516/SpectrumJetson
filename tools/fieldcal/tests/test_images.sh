#!/bin/bash
# The whole pipeline on a rendered recording with a known answer: synth --images (4 cameras,
# 16 spots on half the field, some tags moved, CAD with two mistakes in it) -> solve -> evaluate.
# About 1.5 min to render, seconds to solve. Usage: tests/test_images.sh [WORK_DIR] [SEED]
set -euo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd)
WORK=${1:-$(mktemp -d)}
SEED=${2:-1}
LAYOUT="$HERE/layouts/2026-rebuilt-andymark.json"
"$HERE/fieldcal.sh" synth "$WORK/rec" --layout "$LAYOUT" --images --seed "$SEED"
"$HERE/fieldcal.sh" solve "$WORK/rec" --layout "$LAYOUT" --cad "$WORK/rec/cad.json" --out "$WORK/solve"
"$HERE/fieldcal.sh" evaluate "$WORK/solve" "$WORK/rec/truth.json"
echo "Report: $WORK/solve/report.md"
