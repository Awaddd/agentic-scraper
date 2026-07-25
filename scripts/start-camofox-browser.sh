#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRAPER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
readonly BROWSER_DIR="${1:-$SCRAPER_DIR/../camofox-browser}"
readonly EXECUTABLE_FILE="$SCRAPER_DIR/.camofox/executable"

if [[ ! -f "$EXECUTABLE_FILE" ]]; then
  echo "Run scripts/install-camofox-browser.sh before starting the browser." >&2
  exit 1
fi

export CAMOUFOX_EXECUTABLE
CAMOUFOX_EXECUTABLE="$(<"$EXECUTABLE_FILE")"
export CAMOUFOX_HEADLESS="${CAMOUFOX_HEADLESS:-true}"
if [[ "${SCRAPER_ALLOW_INSECURE_LOCAL:-false}" == "true" ]]; then
	export CAMOFOX_OUTBOUND_POLICY="loopback"
else
	export CAMOFOX_OUTBOUND_POLICY="public"
fi

exec npm --prefix "$BROWSER_DIR" start
