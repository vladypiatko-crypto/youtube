# Installs what the youtube-channel skill needs (Windows): Python 3.9+, ffmpeg, and a
# virtualenv with the Python packages at ~/.claude/youtube-channel/venv. Safe to re-run.
$ErrorActionPreference = "Stop"

$Venv = Join-Path $HOME ".claude\youtube-channel\venv"
function Say($m) { Write-Host "`n==> $m" -ForegroundColor Magenta }
function Warn($m) { Write-Host "!! $m" -ForegroundColor Yellow }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User") }

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

Say "Installing Python packages (in the skill's own virtualenv)"
$VPy = "$Venv\Scripts\python.exe"
New-Item -ItemType Directory -Force -Path (Split-Path $Venv) | Out-Null
if (-not (Test-Path $VPy)) { & $Py -m venv $Venv }
& $VPy -m pip install -q --upgrade pip
& $VPy -m pip install -q -r "$PSScriptRoot\requirements.txt"

Say "Environment check"
& $VPy "$PSScriptRoot\check_env.py"

Write-Host "`nSetup done. Python for the skill: $VPy" -ForegroundColor Green
