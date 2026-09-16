#!/usr/bin/env bash
# tippecanoe is AUR-only on Arch and is a source build, so a fresh clone will
# not have it. The tile build is useless without it and its absence is much
# clearer here than three steps later inside a pipeline.
set -euo pipefail
if ! command -v tippecanoe >/dev/null 2>&1; then
  echo "tippecanoe is not installed. On Arch: paru -S tippecanoe" >&2
  echo "Elsewhere: https://github.com/felt/tippecanoe" >&2
  exit 1
fi
echo "tippecanoe $(tippecanoe --version 2>&1 | head -1)"
