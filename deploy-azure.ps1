# Build and package for Azure App Service deployment
# Usage: .\deploy-azure.ps1
# Output: deploy.zip  (upload this to Azure App Service)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Write-Host "Building frontend..." -ForegroundColor Cyan
Push-Location "$root\frontend"
npm install
npm run build
Pop-Location

Write-Host "Creating deployment package..." -ForegroundColor Cyan
$zipPath = "$root\deploy.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath }

# Collect files to zip: backend + built frontend
$tmpDir = "$root\_deploy_tmp"
if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
New-Item -ItemType Directory $tmpDir | Out-Null
New-Item -ItemType Directory "$tmpDir\frontend" | Out-Null

Copy-Item "$root\backend" "$tmpDir\backend" -Recurse
Copy-Item "$root\frontend\dist" "$tmpDir\frontend\dist" -Recurse
Copy-Item "$root\startup.sh" "$tmpDir\startup.sh"
# Copy requirements.txt to root so Oryx detects this as a Python app and installs deps
Copy-Item "$root\backend\requirements.txt" "$tmpDir\requirements.txt"
# Pin Python version so Oryx builds with 3.12 (matching the runtime container)
Copy-Item "$root\.python-version" "$tmpDir\.python-version"

# Remove local venv from the package
$venvPath = "$tmpDir\backend\.venv"
if (Test-Path $venvPath) { Remove-Item $venvPath -Recurse -Force }

Compress-Archive -Path "$tmpDir\*" -DestinationPath $zipPath
Remove-Item $tmpDir -Recurse -Force

$size = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host ""
Write-Host "Created: deploy.zip ($size MB)" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Go to Azure Portal -> your App Service -> Deployment Center"
Write-Host "  2. Choose 'Manual deploy' -> 'Deploy zip'"
Write-Host "  3. Upload deploy.zip"
Write-Host "  4. Set startup command to:"
Write-Host "       /home/site/wwwroot/startup.sh" -ForegroundColor White
Write-Host "  5. Set environment variables under 'Environment variables':"
Write-Host "       AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_SUBSCRIPTION_IDS"
