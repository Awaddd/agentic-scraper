#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <x86_64|aarch64>" >&2
  exit 1
fi

case "$1" in
  x86_64) platform="linux/amd64" ;;
  aarch64) platform="linux/arm64" ;;
  *)
    echo "Unsupported architecture: $1 (expected x86_64 or aarch64)" >&2
    exit 1
    ;;
esac

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRAPER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
readonly BROWSER_DIR="$SCRAPER_DIR/../camofox-browser"

"$SCRIPT_DIR/bootstrap-camofox-browser.sh" "$BROWSER_DIR"
make -C "$BROWSER_DIR" fetch ARCH="$1"
export CAMOFOX_ARCH="$1"
export COMPOSE_PLATFORM="$platform"
docker compose -f "$SCRAPER_DIR/docker-compose.yml" build
exec docker compose -f "$SCRAPER_DIR/docker-compose.yml" up -d
