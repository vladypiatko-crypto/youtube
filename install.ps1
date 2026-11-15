# Installs the youtube-channel skill for Claude Code (Windows).
# Usage: powershell -ExecutionPolicy Bypass -File install.ps1     (re-run any time to update)
$ErrorActionPreference = "Stop"

$Src  = Join-Path $PSScriptRoot ".claude\skills\youtube-channel"
$Dest = Join-Path $HOME ".claude\skills\youtube-channel"
function Say($m) { Write-Host "`n==> $m" -ForegroundColor Magenta }
function Warn($m) { Write-Host "!! $m" -ForegroundColor Yellow }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User") }

if (-not (Test-Path "$Src\SKILL.md")) { throw "Can't find the skill at $Src - run this from the cloned repo." }
$HasWinget = [bool](Get-Command winget -ErrorAction SilentlyContinue)

Say "Checking Python"
$Py = $null
foreach ($c in @("py", "python", "python3")) {
  $cmd = Get-Command $c -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source -notlike "*WindowsApps*") {
    & $c -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" 2>$null
    if ($LASTEXITCODE -eq 0) { $Py = $c; break }
  }
}
if (-not $Py) {
  if (-not $HasWinget) { throw "Install Python 3.12 from https://www.python.org/downloads/ (tick 'Add to PATH'), then re-run." }
  winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements
  Refresh-Path
  $Py = "py"
}
& $Py --version

Say "Checking ffmpeg"
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  if (-not $HasWinget) { throw "Install ffmpeg (https://www.gyan.dev/ffmpeg/builds/) and add it to PATH, then re-run." }
  winget install -e --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements
  Refresh-Path
}
if (Get-Command ffmpeg -ErrorAction SilentlyContinue) { (ffmpeg -version)[0] } else { Warn "ffmpeg installed - open a NEW terminal so it's on PATH." }

Say "Installing the skill to $Dest"
New-Item -ItemType Directory -Force -Path (Split-Path $Dest) | Out-Null
$Tmp = Join-Path $HOME ".claude\.yt-venv-tmp"
if (Test-Path "$Dest\.venv") { Move-Item "$Dest\.venv" $Tmp -Force }
if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force }
Copy-Item $Src $Dest -Recurse
if (Test-Path $Tmp) { Move-Item $Tmp "$Dest\.venv" -Force }
Get-ChildItem $Dest -Recurse -Directory -Filter "__pycache__" | Remove-Item -Recurse -Force

Say "Installing Python packages (in the skill's own virtualenv)"
$VPy = "$Dest\.venv\Scripts\python.exe"
if (-not (Test-Path $VPy)) { & $Py -m venv "$Dest\.venv" }
& $VPy -m pip install -q --upgrade pip
& $VPy -m pip install -q -r "$Dest\scripts\requirements.txt"

Say "Environment check"
& $VPy "$Dest\scripts\check_env.py"

Say "Claude Code"
if (Get-Command claude -ErrorAction SilentlyContinue) { Write-Host "Found Claude Code." }
else { Warn "Claude Code isn't installed yet. Install it with:"; Write-Host "    irm https://claude.ai/install.ps1 | iex" }

Write-Host @"

Done! The skill is installed for every project.

Next:
  1. mkdir ~\my-channel; cd ~\my-channel
  2. claude
  3. Say: "set up my channel" (or describe it: "faceless space facts for teens, Shorts, chill vibe")
"@ -ForegroundColor Green
