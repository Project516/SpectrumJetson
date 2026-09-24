#!/usr/bin/env bash
# Runs the field-calibration tool with its Python environment (see README.md).
HERE=$(cd "$(dirname "$0")" && pwd)
PY=${FIELDCAL_PYTHON:-$HOME/build/fieldcal-venv/bin/python}
PYTHONPATH="$HERE${PYTHONPATH:+:$PYTHONPATH}" exec "$PY" -m fieldcal "$@"
