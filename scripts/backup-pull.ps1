# =============================================================================
# backup-pull.ps1 — доставка бэкапов GymHelper с VPS на ПК владельца
# ([BAK-T2], issue #17, утверждён «Вариант 2»: ПК сам забирает свежий архив
#  с VPS по SSH по расписанию — Windows Task Scheduler).
#
# СЕКРЕТОВ В ФАЙЛЕ НЕТ: аутентификация — через ssh config (Host gym-vps,
# IdentityFile ~/.ssh/backup_key). deploy_key и token.txt не используются.
#
# Запуск вручную:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup-pull.ps1
# Настройка планировщика: scripts\README-pull.md
#
# Exit-коды: 0 — успех (в т.ч. «новых архивов нет»);
#            1 — ошибка (сеть/ssh/scp);
#            2 — на VPS нет архивов (не работает backup.timer?).
# Совместимо с Windows PowerShell 5.1 (без && и прочих новинок PS7).
# =============================================================================

# ---------- Настройки (под машину владельца) ----------
$VpsHost     = 'gym-vps'                 # Host из ~/.ssh/config (ключ backup_key)
$RemoteDir   = '/opt/gym/backups'        # каталог архивов на VPS
$LocalDir    = 'D:\Backups\Gym'          # локальный каталог для архивов
$ArchiveMask = 'gym-data-*.tar.gz'       # маска имён архивов (создаёт deploy/backup.sh)
$KeepDays    = 14                        # локальный ретеншн: хранить архивов не старше N дней
$MarkerFile  = Join-Path $LocalDir 'last-pulled.txt'  # имя последнего скачанного архива
$LogFile     = Join-Path $LocalDir 'backup-pull.log'
# ------------------------------------------------------

$ErrorActionPreference = 'Stop'

function Write-Log {
    param([string]$Message)
    $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Write-Output $line
    try { Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8 -ErrorAction Stop } catch { }
}

try {
    # Каталог назначения и лог-файл должны существовать до первого Write-Log
    if (-not (Test-Path -LiteralPath $LocalDir)) {
        New-Item -ItemType Directory -Path $LocalDir -Force | Out-Null
        Write-Log "Создан локальный каталог: $LocalDir"
    }

    # --- 1. Найти свежий архив на VPS (ssh: ls | sort | tail) ---
    # Если маска ничего не совпала, ls вернёт пусто (ошибка уходит в /dev/null),
    # а код возврата пайплайна определяется tail => 0. Пустой вывод = архивов нет.
    $remoteCmd = "ls -1 '$RemoteDir/$ArchiveMask' 2>/dev/null | sort | tail -n 1"
    $latest = (& ssh -o BatchMode=yes -o ConnectTimeout=20 $VpsHost $remoteCmd 2>$null)
    if ($LASTEXITCODE -ne 0) {
        throw "ssh $VpsHost завершился с кодом $LASTEXITCODE (сеть/ключ/хост?)"
    }
    $latest = ('' + $latest).Trim()
    if ([string]::IsNullOrEmpty($latest)) {
        Write-Log "ERROR: на VPS в $RemoteDir нет архивов под маску '$ArchiveMask' — проверьте backup.timer на сервере"
        exit 2
    }
    $latestName = ($latest -split '/')[ -1 ]     # имя файла без пути (пути с '/' — юникс)

    # --- 2. Сравнить с маркером: не скачан ли этот архив раньше ---
    $lastPulled = ''
    if (Test-Path -LiteralPath $MarkerFile) {
        $raw = Get-Content -LiteralPath $MarkerFile -Raw
        if ($null -ne $raw) { $lastPulled = $raw.Trim() }
    }
    if ($lastPulled -eq $latestName) {
        Write-Log "Новых архивов нет: $latestName уже скачан ранее"
        exit 0
    }

    # --- 3. Скачать scp'ом в LocalDir ---
    $localPath = Join-Path $LocalDir $latestName
    Write-Log "Скачиваю $latestName с ${VpsHost}:$RemoteDir ..."
    & scp -o BatchMode=yes -o ConnectTimeout=20 ("{0}:{1}/{2}" -f $VpsHost, $RemoteDir, $latestName) $localPath
    if ($LASTEXITCODE -ne 0) {
        throw "scp завершился с кодом $LASTEXITCODE"
    }
    $file = Get-Item -LiteralPath $localPath
    if ($file.Length -le 0) {
        throw "скачанный файл пуст: $localPath"
    }
    Write-Log ("Скачано: {0} ({1:N0} байт)" -f $latestName, $file.Length)

    # --- 4. Обновить маркер (только после успешного скачивания) ---
    Set-Content -LiteralPath $MarkerFile -Value $latestName -Encoding ASCII
    Write-Log "Маркер обновлён: $MarkerFile -> $latestName"

    # --- 5. Локальный ретеншн: удалить архивы старше $KeepDays дней ---
    $cutoff = (Get-Date).AddDays(-$KeepDays)
    $deleted = 0
    Get-ChildItem -LiteralPath $LocalDir -Filter $ArchiveMask -File |
        Where-Object { $_.LastWriteTime -lt $cutoff } |
        ForEach-Object {
            Remove-Item -LiteralPath $_.FullName -Force
            Write-Log ("Локальный ретеншн: удалён {0} (от {1:yyyy-MM-dd})" -f $_.Name, $_.LastWriteTime)
            $deleted++
        }
    Write-Log "Готово. Локальный ретеншн: удалено $deleted (окно $KeepDays дн.)"
    exit 0
}
catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    exit 1
}
