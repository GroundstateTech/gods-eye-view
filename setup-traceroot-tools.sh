#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if ! command -v python3 >/dev/null 2>&1; then
  echo 'Install Python 3.10+ first.' >&2; exit 1
fi
exec python3 scripts/traceroot/setup-tools.py
