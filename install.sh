#!/usr/bin/env bash
# Installs the youtube-channel skill for Claude Code (macOS / Linux).
# Usage: bash install.sh        (re-run any time to update)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$REPO/.claude/skills/youtube-channel"
DEST="$HOME/.claude/skills/youtube-channel"
say() { printf '\n\033[1;35m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*"; }

[ -f "$SRC/SKILL.md" ] || { echo "Can't find the skill at $SRC — run this from the cloned repo."; exit 1; }
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

say "Installing the skill to $DEST"
mkdir -p "$HOME/.claude/skills"
VENV_KEEP=""
if [ -d "$DEST/.venv" ]; then mv "$DEST/.venv" "$HOME/.claude/.yt-venv-tmp"; VENV_KEEP=1; fi
rm -rf "$DEST"
cp -R "$SRC" "$DEST"
if [ -n "$VENV_KEEP" ]; then mv "$HOME/.claude/.yt-venv-tmp" "$DEST/.venv"; fi
find "$DEST" -name '__pycache__' -prune -exec rm -rf {} +

say "Installing Python packages (in the skill's own virtualenv)"
[ -x "$DEST/.venv/bin/python" ] || "$PY" -m venv "$DEST/.venv"
"$DEST/.venv/bin/python" -m pip install -q --upgrade pip
"$DEST/.venv/bin/python" -m pip install -q -r "$DEST/scripts/requirements.txt"

say "Environment check"
"$DEST/.venv/bin/python" "$DEST/scripts/check_env.py" | grep -v "Install missing" || true

say "Claude Code"
if command -v claude >/dev/null; then
  echo "Found: $(claude --version 2>/dev/null || echo claude)"
else
  warn "Claude Code isn't installed yet. Install it with:"
  echo "    curl -fsSL https://claude.ai/install.sh | bash"
fi

cat <<EOF

✅ Done! The skill is installed for every project.

Next:
  1. mkdir -p ~/my-channel && cd ~/my-channel
  2. claude
  3. Say: "set up my channel" (or describe it: "faceless space facts for teens, Shorts, chill vibe")

Optional: for uploads/analytics/comments, Claude walks you through the Google sign-in during setup.
Update later: git -C "$REPO" pull && bash "$REPO/install.sh"
EOF
