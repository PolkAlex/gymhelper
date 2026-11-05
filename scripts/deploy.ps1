# Deploy GymHelper to PROD VPS (gym-vps ssh alias).
# RULE: run ONLY after explicit owner approval ("deploy approved").
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy.ps1 [-Yes]
param([switch]$Yes)
$ErrorActionPreference = "Continue"

if (-not $Yes) {
    $a = Read-Host "Deploy to PROD? Type 'y' to continue"
    if ($a -ne "y") { Write-Host "Aborted."; exit 1 }
}

Write-Host "== 1/5 git pull =="
git pull
if ($LASTEXITCODE -ne 0) { Write-Host "GIT PULL FAILED"; exit 1 }

Write-Host "== 2/5 compile (Java 17 target - VPS runs Java 17!) =="
Remove-Item out\gym -Recurse -Force -ErrorAction SilentlyContinue
javac --release 17 -encoding UTF-8 -d out (Get-ChildItem -Recurse src -Filter *.java).FullName
if ($LASTEXITCODE -ne 0) { Write-Host "COMPILE FAILED"; exit 1 }
Write-Host "compile OK"

Write-Host "== 3/5 upload (classes + web) =="
scp -r out gym-vps:/opt/gym/
if ($LASTEXITCODE -ne 0) { Write-Host "SCP CLASSES FAILED"; exit 1 }
foreach ($f in "index.html","style.css","app.js","catalog.js") {
    scp "web\$f" "gym-vps:/opt/gym/web/$f"
    if ($LASTEXITCODE -ne 0) { Write-Host "SCP FAILED: web/$f"; exit 1 }
}
Write-Host "upload OK"

Write-Host "== 4/5 restart bot =="
ssh gym-vps "systemctl restart gymbot"
Start-Sleep -Seconds 8
ssh gym-vps "systemctl is-active gymbot"
ssh gym-vps "curl -s http://127.0.0.1:8080/health"
if ($LASTEXITCODE -ne 0) { Write-Host "HEALTH CHECK FAILED"; exit 1 }

Write-Host "== 5/5 verify web version =="
ssh gym-vps "grep -o 'v=[0-9]*' /opt/gym/web/index.html | head -1"
Write-Host "Deploy finished. Check PROD in Telegram: new design, /start shows hints without legacy words."
