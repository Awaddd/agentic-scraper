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

new_clone=false
if [[ ! -e "$BROWSER_DIR" ]]; then
  git clone "$BROWSER_REPOSITORY" "$BROWSER_DIR"
  new_clone=true
fi
if [[ ! -d "$BROWSER_DIR/.git" ]]; then
  echo "Expected a Git checkout at: $BROWSER_DIR" >&2
  exit 1
fi

cd "$BROWSER_DIR"

if [[ "$new_clone" != true && -n "$(git status --porcelain=v1 --untracked-files=all)" ]]; then
  expected_dir="$(mktemp -d)"
  trap 'rm -rf "$expected_dir"' EXIT
  git clone --quiet --no-checkout "$BROWSER_DIR" "$expected_dir"
  git -C "$expected_dir" checkout --detach "$PINNED_COMMIT"
  for patch in "${patches[@]}"; do
    git -C "$expected_dir" apply --check "$patch"
  done
  git -C "$expected_dir" apply "${patches[@]}"

  if diff -qr --exclude=.git "$expected_dir" "$BROWSER_DIR" >/dev/null; then
    echo "Pinned Camoufox patches are already applied."
    exit 0
  fi
  echo "Refusing browser checkout with local or untracked changes." >&2
  exit 1
fi

git fetch --quiet origin "$PINNED_COMMIT"
git checkout --detach "$PINNED_COMMIT"

# Validate every patch before changing the checkout, then apply the whole set.
for patch in "${patches[@]}"; do
  git apply --check "$patch"
done
git apply "${patches[@]}"
echo "Prepared camofox-browser at $PINNED_COMMIT with public patches."
