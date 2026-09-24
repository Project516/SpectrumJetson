#!/usr/bin/env bash
# Runs the field-calibration tool with its Python environment (see README.md). On the Jetson, the
# system Python has what it needs (numpy, scipy, OpenCV).
HERE=$(cd "$(dirname "$0")" && pwd)
PY=${FIELDCAL_PYTHON:-$HOME/build/fieldcal-venv/bin/python}
[[ -x $PY ]] || PY=python3
PYTHONPATH="$HERE${PYTHONPATH:+:$PYTHONPATH}" exec "$PY" -m fieldcal "$@"
