#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js is missing. Install Node.js 24.14+ (24.x) or 26.x from https://nodejs.org/' >&2
  exit 1
fi
exec node scripts/run-local.mjs "$@"
