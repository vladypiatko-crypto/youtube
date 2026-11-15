---
description: Install what the YouTube skill needs (ffmpeg, Python packages) and set up your channel
---
Use the youtube-channel skill.

1. Install dependencies by running the skill's setup script from its base directory: `bash scripts/setup.sh` on macOS/Linux, or `powershell -ExecutionPolicy Bypass -File scripts/setup.ps1` on Windows. It may ask for the user's password (for installing ffmpeg/Python). If something fails, explain it in plain words and how to fix it.
2. Then run the skill's **Setup** for the channel in the current folder (skip this if `channel/channel.json` already exists, and just say it's ready).

Extra info from the user (may be empty): $ARGUMENTS
