#!/bin/sh
set -eu
command -v node >/dev/null 2>&1 || { echo 'LoomOS needs Node 24 or newer.' >&2; exit 1; }
exec node "$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)/loom-os.mjs" install "$@"
