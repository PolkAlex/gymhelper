# Деплой GymHelper на ПРОД VPS (ssh-алиас gym-vps) через ghcr-образ.
# Сборка происходит в CI: push в main публикует ghcr.io/polkalex/gymhelper:latest;
# этот скрипт только ждёт зелёного CI, пуллит образ на VPS и перезапускает compose.
# ПРАВИЛО: подтверждение владельца обязательно ("деплой разрешён") — это прод.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy.ps1 [-Yes]
param([switch]$Yes)
$ErrorActionPreference = "Continue"

if (-not $Yes) {
    $a = Read-Host "Deploy to PROD? Type 'y' to continue"
    if ($a -ne "y") { Write-Host "Aborted."; exit 1 }
}

# деплой только из main: CI публикует образ из main, pull чужого sha ничего не найдёт
$branch = git rev-parse --abbrev-ref HEAD
if ($LASTEXITCODE -ne 0 -or $null -eq $branch) { Write-Host "GIT REV-PARSE FAILED (branch)"; exit 1 }
$branch = $branch.Trim()
if ($branch -ne "main") {
    Write-Host "Деплой только из main (текущая ветка: $branch)."
    exit 1
}

Write-Host "== 1/5 git pull =="
git pull
if ($LASTEXITCODE -ne 0) { Write-Host "GIT PULL FAILED"; exit 1 }

$sha = git rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $null -eq $sha) { Write-Host "GIT REV-PARSE FAILED (HEAD sha)"; exit 1 }
$sha = $sha.Trim()

# CI на свежезапулнутый коммит мог ещё не стартовать — ждём появления run с этим sha
# до 3 минут, опрос раз в 20 секунд
Write-Host "== 2/5 waiting for green CI on HEAD ($sha) =="
$runId = $null
$deadline = (Get-Date).AddMinutes(3)
while ($true) {
    $runsJson = gh run list --workflow ci.yml --branch main --limit 5 --json databaseId,headSha,status,conclusion
    if ($LASTEXITCODE -eq 0 -and $runsJson) {
        $runs = $runsJson | ConvertFrom-Json
        $mine = @($runs | Where-Object { $_.headSha -eq $sha })
        if ($mine.Count -gt 0) { $runId = $mine[0].databaseId; break }
    }
    if ((Get-Date) -gt $deadline) { break }
    Write-Host "CI run for $sha not started yet, waiting 20s..."
    Start-Sleep -Seconds 20
}
if (-not $runId) {
    Write-Host "ERROR: CI run for commit $sha not found on main (commits pushed?)."; exit 1
}
Write-Host "CI run found: $runId"

# ждём завершения CI (внутри и публикация образа), таймаут ~20 минут.
# Опрос статуса вместо `gh run watch`: watch через Start-Process в не-интерактивной
# консоли возвращает мусорный exit-код даже для зелёного прогона (случай 06.11.2026)
Write-Host "waiting for CI run $runId to complete (poll 30s, timeout 20 min)..."
$deadline = (Get-Date).AddMinutes(20)
$ciOk = $false
while ($true) {
    $statusJson = gh run view $runId --json status,conclusion
    if ($LASTEXITCODE -eq 0 -and $statusJson) {
        $st = $statusJson | ConvertFrom-Json
        if ($st.status -eq "completed") {
            if ($st.conclusion -eq "success") { $ciOk = $true }
            break
        }
    }
    if ((Get-Date) -gt $deadline) { break }
    Start-Sleep -Seconds 30
}
if (-not $ciOk) {
    Write-Host "ERROR: CI run $runId not green in 20 min (or failed) — image NOT published."; exit 1
}
Write-Host "CI green, image published to ghcr.io"

Write-Host "== 3/5 upload docker-compose.yml =="
scp docker-compose.yml gym-vps:/opt/gym/docker-compose.yml
if ($LASTEXITCODE -ne 0) { Write-Host "SCP COMPOSE FAILED"; exit 1 }

Write-Host "== 4/5 pull image and restart =="
ssh gym-vps "cd /opt/gym && docker compose pull && docker compose up -d --remove-orphans"
if ($LASTEXITCODE -ne 0) { Write-Host "COMPOSE UP FAILED"; exit 1 }

# даём боту время подняться, затем опрашиваем health: до 8 попыток с интервалом 10 сек
Write-Host "== 5/5 health check =="
$health = $null
for ($i = 1; $i -le 8; $i++) {
    $health = ssh gym-vps "curl -s http://127.0.0.1:8080/health"
    if ($health -and $health -like '*"ok":true*') { break }
    Write-Host "attempt $i/8: no ok:true yet, waiting 10s..."
    Start-Sleep -Seconds 10
}
if (-not $health -or $health -notlike '*"ok":true*') {
    Write-Host "HEALTH CHECK FAILED after 8 attempts: no ok:true in response"; exit 1
}
Write-Host $health
ssh gym-vps "docker compose -f /opt/gym/docker-compose.yml ps"
if ($LASTEXITCODE -ne 0) { Write-Host "COMPOSE PS FAILED"; exit 1 }

Write-Host "Deploy finished. Image: ghcr.io/polkalex/gymhelper:latest. Check PROD in Telegram."
