# =============================================================================
# ana-pull.ps1 — автоматизация выгрузки ANA-дашборда ([ANA-T4], issue #231)
# Цепочка: на VPS ana-export.sh кладёт агрегаты /stats в /tmp/ana-stats.json
# → отсюда ssh забирает JSON на локальную машину → ana-to-gist.mjs сжимает
# его в {totals, weeks} → gh gist edit обновляет secret-gist → Grafana Cloud.
#
# СЕКРЕТОВ В ФАЙЛЕ НЕТ: GYM_ADMIN_TOKEN живёт только на VPS (/opt/gym/.env),
# на локальную машину попадает лишь JSON со счётчиками (без ПДн).
# id гиста читается из tools\ana-gist-id.txt (в .gitignore, не коммитится).
#
# Запуск вручную / проверка шагов без выполнения (-WhatIf):
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\ana-pull.ps1 [-WhatIf]
# Расписание (ежечасно, как backup-pull.ps1): docs/metrics.md, раздел «ANA-дашборд».
#
# Exit-коды: 0 — успех (гист обновлён);
#            1 — ошибка (ssh/node/gh, пустой или битый ответ VPS);
#            2 — гист ещё не настроен (нет tools\ana-gist-id.txt):
#                выгрузка на локали прошла, напечатана подсказка.
# Совместимо с Windows PowerShell 5.1 (без && и прочих новинок PS7).
# =============================================================================
[CmdletBinding(SupportsShouldProcess = $true)]
param()

# ---------- Настройки (под машину владельца) ----------
$VpsHost    = 'gym-vps'                         # Host-алиас из ~/.ssh/config (как в deploy.ps1/backup-pull.ps1); можно переопределить, напр. 'root@45.91.169.125'
$RemoteSh   = '/opt/gym/ana-export.sh'          # скрипт выгрузки на VPS (кладёт lead)
$RemoteJson = '/tmp/ana-stats.json'             # агрегаты на VPS (chmod 600)
$NodeExe    = 'C:\Program Files\nodejs\node.exe'      # стандартный путь установки node — настройте под машину
$GhExe      = 'C:\Program Files\GitHub CLI\gh.exe'    # планировщик может не иметь gh в PATH — полный путь; настройте под машину
$RepoRoot   = Split-Path -Parent $PSScriptRoot  # корень репозитория (tools\..)
$GistIdFile = Join-Path $RepoRoot 'tools\ana-gist-id.txt'
$TempDir    = Join-Path $env:TEMP 'opencode'
$TempJson   = Join-Path $TempDir 'ana-stats-pulled.json'  # сырой JSON с VPS
$GistJson   = Join-Path $TempDir 'ana-stats.json'         # компактный JSON для гиста
$LogFile    = Join-Path $TempDir 'ana-pull.log'
# ------------------------------------------------------

$ErrorActionPreference = 'Stop'

function Write-Log {
    param([string]$Message)
    $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Write-Output $line
    try { Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8 -ErrorAction Stop } catch { }
}

if ($WhatIfPreference) {
    Write-Output 'WhatIf: печатаю шаги без выполнения.'
    Write-Output " 1. ssh $VpsHost `"sh $RemoteSh`" (токен из .env остаётся на VPS)"
    Write-Output " 2. ssh $VpsHost `"cat $RemoteJson`" -> $TempJson (+ валидация JSON)"
    Write-Output " 3. & `"$NodeExe`" tools\ana-to-gist.mjs $TempJson -> $GistJson"
    Write-Output " 4. & `"$GhExe`" gist edit <id из $GistIdFile> --filename ana-stats.json `"$GistJson`""
    Write-Output " Лог: $LogFile"
    exit 0
}

try {
    # Каталог для лога и temp-файлов должен существовать до первого Write-Log
    if (-not (Test-Path -LiteralPath $TempDir)) {
        New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
        Write-Log "Создан локальный каталог: $TempDir"
    }

    # --- 1. На VPS: ana-export.sh — curl /stats с токеном из .env → /tmp/ana-stats.json.
    # Токен в URL/выводе не печатается: скрипт выводит только путь или ошибку.
    Write-Log "Шаг 1/4: запускаю $RemoteSh на VPS ($VpsHost) ..."
    & ssh -o BatchMode=yes -o ConnectTimeout=20 $VpsHost "sh $RemoteSh"
    if ($LASTEXITCODE -ne 0) {
        throw "ssh $VpsHost `"sh $RemoteSh`" завершился с кодом $LASTEXITCODE (скрипт не залит на VPS? контейнер не отвечает?)"
    }

    # --- 2. Забрать JSON: ssh cat + валидация. Через PS-переменную, а не через '>'
    # (PS 5.1 писал бы UTF-16LE, и node не прочитал бы файл); JSON — только ASCII,
    # многострочный вывод склеиваем с переводом строки (пробел/'\n' в JSON равнозначны).
    Write-Log "Шаг 2/4: забираю $RemoteJson с VPS ..."
    $raw = (@(& ssh -o BatchMode=yes -o ConnectTimeout=20 $VpsHost "cat $RemoteJson") -join "`n").Trim()
    if ($LASTEXITCODE -ne 0) {
        throw "ssh `"cat $RemoteJson`" завершился с кодом $LASTEXITCODE (файла нет — шаг 1 упал?)"
    }
    if ([string]::IsNullOrEmpty($raw)) {
        throw "с VPS получен пустой ответ вместо JSON (шаг 1 не отработал?)"
    }
    try { $null = ConvertFrom-Json $raw } catch {
        throw "с VPS получен не валидный JSON — прерываю, локальный temp не пишу"
    }
    [System.IO.File]::WriteAllText($TempJson, $raw)   # UTF-8 без BOM
    Write-Log ("Сохранено: {0} ({1} симв.)" -f $TempJson, $raw.Length)

    # --- 3. ana-to-gist.mjs: сжатие до {generatedAt, source, totals, weeks}.
    # Env-источник приглушаем: данные должны прийти из забранного с VPS файла
    # (при заданных GYM_STATS_URL+GYM_ADMIN_TOKEN скрипт пошёл бы в URL, минуя файл).
    Write-Log "Шаг 3/4: & `"$NodeExe`" tools\ana-to-gist.mjs ..."
    $savedUrl = $env:GYM_STATS_URL
    $savedTok = $env:GYM_ADMIN_TOKEN
    try {
        $env:GYM_STATS_URL = ''
        $env:GYM_ADMIN_TOKEN = ''
        & $NodeExe (Join-Path $PSScriptRoot 'ana-to-gist.mjs') $TempJson
        if ($LASTEXITCODE -ne 0) {
            throw "node ana-to-gist.mjs завершился с кодом $LASTEXITCODE"
        }
    }
    finally {
        $env:GYM_STATS_URL = $savedUrl
        $env:GYM_ADMIN_TOKEN = $savedTok
    }
    if (-not (Test-Path -LiteralPath $GistJson)) {
        throw "ana-to-gist.mjs не создал $GistJson"
    }

    # --- 4. Обновить secret-gist: id из tools\ana-gist-id.txt (в .gitignore).
    if (-not (Test-Path -LiteralPath $GistIdFile)) {
        Write-Log 'Гист ещё не настроен — останавливаюсь перед gh gist edit. Настройка ОДНОРАЗОВАЯ:'
        Write-Log ("  & ""{0}"" gist create -d ""GymHelper ANA stats (Grafana Infinity)"" ""{1}""" -f $GhExe, $GistJson)
        Write-Log ("  полученный id (одной строкой) сохранить в {0} (файл в .gitignore), затем перезапустить скрипт" -f $GistIdFile)
        exit 2
    }
    $gistId = ('' + (Get-Content -LiteralPath $GistIdFile -Raw)).Trim()
    if ($gistId -notmatch '^[0-9a-fA-F]{16,64}$') {
        throw "в $GistIdFile не gist id ('$gistId') — жду одну hex-строку"
    }
    Write-Log "Шаг 4/4: gh gist edit $gistId --filename ana-stats.json ..."
    & $GhExe gist edit $gistId --filename ana-stats.json $GistJson
    if ($LASTEXITCODE -ne 0) {
        throw "gh gist edit завершился с кодом $LASTEXITCODE (gh авторизован? gist существует?)"
    }

    Write-Log "Готово: gist $gistId обновлён из $GistJson"
    exit 0
}
catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    exit 1
}
