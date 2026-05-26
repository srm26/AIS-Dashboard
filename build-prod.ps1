# Build for production (React → dist, then serve via FastAPI)
# Output: backend serves everything on port 8000

$ErrorActionPreference = "Stop"
Write-Host "Building production bundle..." -ForegroundColor Cyan

Push-Location frontend
npm install
npm run build
Pop-Location

Write-Host "Build complete. Run backend to serve the app:" -ForegroundColor Green
Write-Host "  cd backend && .venv\Scripts\Activate.ps1 && python main.py" -ForegroundColor White
