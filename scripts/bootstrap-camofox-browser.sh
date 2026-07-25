#!/usr/bin/env bash
set -euo pipefail

readonly PINNED_COMMIT="ce3a3b085aacba73eb8de6c51733c19fb13bfae4"
readonly BROWSER_REPOSITORY="https://github.com/jo-inc/camofox-browser.git"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRAPER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
readonly BROWSER_DIR="${1:-$SCRAPER_DIR/../camofox-browser}"

patches=("$SCRAPER_DIR"/patches/camofox-browser/*.patch)
if [[ ! -e "${patches[0]}" ]]; then
  echo "No Camoufox patches were found." >&2
  exit 1
fi

if [[ ! -e "$BROWSER_DIR" ]]; then
  git clone "$BROWSER_REPOSITORY" "$BROWSER_DIR"
fi
if [[ ! -d "$BROWSER_DIR/.git" ]]; then
  echo "Expected a Git checkout at: $BROWSER_DIR" >&2
  exit 1
fi

cd "$BROWSER_DIR"

all_applied=true
all_unapplied=true
for patch in "${patches[@]}"; do
  if git apply --reverse --check "$patch" 2>/dev/null; then
    all_unapplied=false
  elif git apply --check "$patch" 2>/dev/null; then
    all_applied=false
  else
    echo "Patch is incompatible with the pinned browser source: $patch" >&2
    exit 1
  fi
done

if ! git diff --quiet || ! git diff --cached --quiet; then
  if [[ "$all_applied" != true ]]; then
    echo "Refusing to modify a browser checkout with local changes." >&2
    exit 1
  fi
  dirty_paths="$(git diff --name-only; git diff --cached --name-only)"
  while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    if ! printf '%s\n' "${patches[@]}" | xargs grep -q "^+++ b/$path$"; then
      echo "Refusing unrelated local browser modification: $path" >&2
      exit 1
    fi
  done <<< "$dirty_paths"
  echo "Pinned Camoufox patches are already applied."
  exit 0
fi

git fetch --quiet origin "$PINNED_COMMIT"
git checkout --detach "$PINNED_COMMIT"

# Validate every patch before changing the checkout, then apply the whole set.
for patch in "${patches[@]}"; do
  git apply --check "$patch"
done
git apply "${patches[@]}"
echo "Prepared camofox-browser at $PINNED_COMMIT with public patches."
