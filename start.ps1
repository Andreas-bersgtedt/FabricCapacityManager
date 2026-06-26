# Clean reinstall and start the dev server.
# Removes node_modules, installs dependencies, then runs the Vite dev server.

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

# Free the Vite dev port so a stale server can't push us onto a different port
# (which leads to viewing outdated code in the browser).
$devPort = 5173
$listeners = Get-NetTCPConnection -LocalPort $devPort -State Listen -ErrorAction SilentlyContinue
foreach ($procId in ($listeners.OwningProcess | Select-Object -Unique)) {
    Write-Host "Stopping process on port $devPort (PID $procId)..." -ForegroundColor Yellow
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
}

if (Test-Path -Path "node_modules") {
    Write-Host "Removing node_modules..." -ForegroundColor Cyan
    Remove-Item -Path "node_modules" -Recurse -Force
}

Write-Host "Installing dependencies (npm install)..." -ForegroundColor Cyan
npm install

Write-Host "Starting dev server (npm run dev)..." -ForegroundColor Cyan
npm run dev
