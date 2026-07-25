#!/usr/bin/env bash
set -euo pipefail

readonly CAMOUFOX_VERSION="135.0.1-beta.24"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRAPER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
readonly BROWSER_DIR="${1:-$SCRAPER_DIR/../camofox-browser}"
readonly STATE_DIR="$SCRAPER_DIR/.camofox"
readonly EXECUTABLE_FILE="$STATE_DIR/executable"

if [[ ! -d "$BROWSER_DIR/.git" ]]; then
	"$SCRIPT_DIR/bootstrap-camofox-browser.sh" "$BROWSER_DIR"
fi

"$SCRIPT_DIR/bootstrap-camofox-browser.sh" "$BROWSER_DIR"

case "$(uname -s)" in
  Darwin) platform="mac" ;;
  Linux) platform="lin" ;;
  *)
    echo "This bootstrap supports macOS and Linux." >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  arm64 | aarch64) architecture="arm64" ;;
  x86_64 | amd64) architecture="x86_64" ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

for patch in "$SCRAPER_DIR"/patches/camofox-browser/*.patch; do
  if git -C "$BROWSER_DIR" apply --reverse --check "$patch" 2>/dev/null; then
    continue
  fi

  git -C "$BROWSER_DIR" apply --check "$patch"
  git -C "$BROWSER_DIR" apply "$patch"
done

npm --prefix "$BROWSER_DIR" install --ignore-scripts

bundle_dir="$STATE_DIR/camoufox-$CAMOUFOX_VERSION-$platform.$architecture"
asset="camoufox-$CAMOUFOX_VERSION-$platform.$architecture.zip"
url="https://github.com/daijro/camoufox/releases/download/v$CAMOUFOX_VERSION/$asset"

mkdir -p "$STATE_DIR"
find "$STATE_DIR" -mindepth 1 -maxdepth 1 -type d -name '.staging-*' -exec rm -rf {} +

if [[ ! -d "$bundle_dir" ]]; then
	staging_dir="$(mktemp -d "$STATE_DIR/.staging-XXXXXX")"
	archive="$staging_dir/$asset"
	trap 'rm -rf "$staging_dir"' EXIT
	curl --fail --location --silent --show-error "$url" --output "$archive"
	unzip -q "$archive" -d "$staging_dir/extract"
	if [[ "$platform" == "mac" ]]; then
		executable="$(find "$staging_dir/extract" -path '*/Camoufox.app/Contents/MacOS/camoufox' -type f -print -quit)"
	else
		executable="$(find "$staging_dir/extract" -name camoufox-bin -type f -print -quit)"
	fi
	if [[ -z "$executable" ]]; then
		echo "Could not find the Camoufox executable in downloaded archive." >&2
		exit 1
	fi
	mv "$staging_dir/extract" "$bundle_dir"
	trap - EXIT
fi

if [[ "$platform" == "mac" ]]; then
  executable="$(find "$bundle_dir" -path '*/Camoufox.app/Contents/MacOS/camoufox' -type f -print -quit)"
else
  executable="$(find "$bundle_dir" -name camoufox-bin -type f -print -quit)"
fi

if [[ -z "$executable" ]]; then
  echo "Could not find the Camoufox executable in: $bundle_dir" >&2
  exit 1
fi

printf '%s\n' "$executable" > "$EXECUTABLE_FILE"
printf 'Installed Camoufox %s at %s\n' "$CAMOUFOX_VERSION" "$executable"
