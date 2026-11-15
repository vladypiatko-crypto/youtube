#!/usr/bin/env bash
# Installs what the youtube-channel skill needs (macOS / Linux): Python 3.9+, ffmpeg, and a
# virtualenv with the Python packages at ~/.claude/youtube-channel/venv. Safe to re-run.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$HOME/.claude/youtube-channel/venv"
say() { printf '\n\033[1;35m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*"; }

OS="$(uname -s)"

pkg_install() {  # pkg_install <brew-name> <apt-name>
  if [ "$OS" = "Darwin" ]; then
    if ! command -v brew >/dev/null; then
      warn "Homebrew is missing. Install it from https://brew.sh, then re-run this script."; exit 1
    fi
    brew install "$1"
  elif command -v apt-get >/dev/null; then sudo apt-get update -qq && sudo apt-get install -y "$2"
  elif command -v dnf >/dev/null; then sudo dnf install -y "$2"
  elif command -v pacman >/dev/null; then sudo pacman -S --noconfirm "$2"
  else warn "Please install $2 with your package manager and re-run."; exit 1
  fi
}

say "Checking Python"
PY=""
for c in python3 python; do
  if command -v "$c" >/dev/null && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)'; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then
  pkg_install python python3
  PY=python3
fi
if [ "$OS" != "Darwin" ] && ! "$PY" -m venv --help >/dev/null 2>&1; then pkg_install python3-venv python3-venv; fi
echo "Using $("$PY" --version)"

say "Checking ffmpeg"
if ! command -v ffmpeg >/dev/null; then pkg_install ffmpeg ffmpeg; fi
ffmpeg -version | head -1

say "Installing Python packages (in the skill's own virtualenv)"
mkdir -p "$(dirname "$VENV")"
[ -x "$VENV/bin/python" ] || "$PY" -m venv "$VENV"
"$VENV/bin/python" -m pip install -q --upgrade pip
"$VENV/bin/python" -m pip install -q -r "$HERE/requirements.txt"

say "Environment check"
"$VENV/bin/python" "$HERE/check_env.py" | grep -v "Install missing" || true

echo
echo "✅ Setup done. Python for the skill: $VENV/bin/python"
