# Start backend + frontend (dev mode)
# Usage: .\start.ps1

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Write-Host "Starting Azure Logic Apps Dashboard..." -ForegroundColor Cyan

# --- Locate Python ---
$python = $null
foreach ($candidate in @("py", "python3", "python")) {
    try {
        $ver = & $candidate --version 2>&1
        if ($ver -match "Python 3") { $python = $candidate; break }
    } catch {}
}
if (-not $python) {
    Write-Host ""
    Write-Host "ERROR: Python 3 not found on PATH." -ForegroundColor Red
    Write-Host "Install from https://www.python.org/downloads/" -ForegroundColor Yellow
    Write-Host "Check 'Add Python to PATH' during install, then re-run." -ForegroundColor Yellow
    exit 1
}
$pyVer = & $python --version 2>&1
Write-Host "Using Python: $python ($pyVer)" -ForegroundColor DarkGray

# --- Backend ---
Push-Location "$root\backend"

if (-not (Test-Path ".env")) {
    Copy-Item "$root\.env.example" ".env" -ErrorAction SilentlyContinue
    Write-Host "Created backend\.env - fill in your Azure credentials." -ForegroundColor Yellow
}

if (-not (Test-Path ".venv")) {
    Write-Host "Creating Python venv..."
    & $python -m venv .venv
}

$activate = "$root\backend\.venv\Scripts\Activate.ps1"
& $activate
pip install -r requirements.txt -q

$backendDir = "$root\backend"
Start-Process powershell -ArgumentList "-NoExit", "-Command", `
    "Set-Location '$backendDir'; & '$activate'; python main.py" `
    -WindowStyle Normal

Pop-Location

# --- Frontend ---
Push-Location "$root\frontend"

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing frontend dependencies..."
    npm install
}

$frontendDir = "$root\frontend"
Start-Process powershell -ArgumentList "-NoExit", "-Command", `
    "Set-Location '$frontendDir'; npm run dev" `
    -WindowStyle Normal

Pop-Location

Write-Host ""
Write-Host "Backend:  http://localhost:8000" -ForegroundColor Green
Write-Host "Frontend: http://localhost:3000" -ForegroundColor Green
Write-Host ""
Write-Host "Press any key to exit (servers keep running in their own windows)."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
