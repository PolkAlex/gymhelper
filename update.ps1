$ErrorActionPreference = 'Continue'
$srv = 'root@45.91.169.125'
Set-Location $PSScriptRoot

Write-Host '[1/3] Uploading files to server...' -ForegroundColor Cyan
scp -r src web "$srv`:/opt/gym/"
if ($LASTEXITCODE -ne 0) { Write-Host 'ERROR: scp failed. Run this from the project folder.' -ForegroundColor Red; exit 1 }

Write-Host '[2/3] Compiling and restarting bot...' -ForegroundColor Cyan
ssh $srv 'cd /opt/gym; javac -encoding UTF-8 -d out $(find src -name "*.java"); systemctl restart gymbot'
if ($LASTEXITCODE -ne 0) { Write-Host 'ERROR on server (see text above)' -ForegroundColor Red; exit 1 }

Write-Host '[3/3] Done! Bot updated and restarted.' -ForegroundColor Green
Write-Host 'Logs: ssh root@45.91.169.125 "journalctl -u gymbot -n 20 --no-pager"'
