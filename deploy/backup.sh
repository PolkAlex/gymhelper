#!/usr/bin/env bash
# =============================================================================
# gym-backup.sh — ежедневный бэкап data/ GymHelper на VPS ([BAK-T1], issue #16)
#
# Что делает:
#   1. Упаковывает DATA_DIR в BACKUP_DIR/PREFIX-YYYY-MM-DD-HHMM.tar.gz
#      (внутри архива путь data/..., восстановление: tar -xzf в /opt/gym)
#   2. Ретеншн (решение владельца): 14 дневных + 8 недельных + 12 месячных
#   3. Лог в LOG_FILE + stdout; опционально уведомление в Telegram
#
# Установка и восстановление данных: deploy/README-backup.md
# Exit-коды: 0 — успех; 1 — ошибка; 2 — предыдущий запуск ещё не закончился.
# Требования: bash, GNU date/tar/find; curl — только для Telegram-уведомлений.
# =============================================================================

# ---------- Настройки ----------
DATA_DIR="/opt/gym/data"          # каталог с данными пользователей
BACKUP_DIR="/opt/gym/backups"     # куда складывать архивы
ARCHIVE_PREFIX="gym-data"         # маска имён: PREFIX-YYYY-MM-DD-HHMM.tar.gz

# Ретеншн — сколько периодов храним (см. блок «Ретеншн» ниже)
KEEP_DAILY=14                     # последние 14 дней храним все архивы
KEEP_WEEKLY=8                     # + по одному (воскресному) архиву за каждую из 8 недель (~2 месяца)
KEEP_MONTHLY=12                   # + по одному (последнему в месяце) архиву за каждый из 12 месяцев

LOG_FILE="/var/log/gym-backup.log"
LOCK_FILE="/run/lock/gym-backup.lock"

# Уведомление в Telegram владельцу (пустые значения = не отправлять)
TG_BOT_TOKEN=""
TG_CHAT_ID=""

set -euo pipefail

tmp=""            # временный файл ретеншна, чистится в on_exit
LOCK_MODE=""      # "flock" | "dir" — способ захвата замка

log() {
  local line="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  echo "$line"
  if [ -n "$LOG_FILE" ]; then
    echo "$line" >> "$LOG_FILE" 2>/dev/null || true
  fi
}

tg_send() {
  # Никогда не роняет скрипт: Telegram может быть не настроен/недоступен
  if [ -n "$TG_BOT_TOKEN" ] && [ -n "$TG_CHAT_ID" ] && command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 15 \
         "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
         -d chat_id="${TG_CHAT_ID}" -d text="$1" >/dev/null 2>&1 \
      || log "WARN: не удалось отправить уведомление в Telegram"
  fi
}

on_exit() {
  local code=$?
  if [ -n "$tmp" ] && [ -f "$tmp" ]; then rm -f "$tmp"; fi
  if [ "$LOCK_MODE" = "dir" ]; then rmdir "${LOCK_FILE}.dir" 2>/dev/null || true; fi
  if [ "$code" -ne 0 ] && [ "$code" -ne 2 ]; then
    log "ERROR: бэкап завершился с кодом $code"
    tg_send "❌ GymHelper backup FAILED (exit $code)"
  fi
}
trap on_exit EXIT

# --- Лог-файл: если недоступен — работаем без него (только stdout) ---
if ! touch "$LOG_FILE" 2>/dev/null; then
  echo "WARN: нет доступа к $LOG_FILE, лог только в stdout" >&2
  LOG_FILE=""
fi

# =============================================================================
# Замок от повторного запуска (по расписанию + ручной запуск могут совпасть)
# =============================================================================
mkdir -p "$(dirname "$LOCK_FILE")"
if command -v flock >/dev/null 2>&1; then
  exec 9>>"$LOCK_FILE"
  flock -n 9 || { log "ERROR: предыдущий бэкап ещё выполняется ($LOCK_FILE)"; exit 2; }
  LOCK_MODE="flock"
else
  # Fallback без flock: каталог-замок (mkdir атомарен), убирается в on_exit
  if ! mkdir "${LOCK_FILE}.dir" 2>/dev/null; then
    log "ERROR: предыдущий бэкап ещё выполняется (${LOCK_FILE}.dir)"
    exit 2
  fi
  LOCK_MODE="dir"
fi

# =============================================================================
# Упаковка data/
# =============================================================================
mkdir -p "$BACKUP_DIR"

STAMP=$(date '+%Y-%m-%d-%H%M')
ARCHIVE="$BACKUP_DIR/${ARCHIVE_PREFIX}-${STAMP}.tar.gz"

log "Старт бэкапа: $DATA_DIR -> $ARCHIVE"
# Внутри архива путь data/... : восстановление = tar -xzf в каталог /opt/gym
if ! tar -czf "$ARCHIVE" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")"; then
  rm -f "$ARCHIVE"
  log "ERROR: tar завершился с ошибкой"
  tg_send "❌ GymHelper backup FAILED: tar error"
  exit 1
fi
SIZE=$(du -h "$ARCHIVE" | cut -f1)
log "Архив создан: $ARCHIVE ($SIZE)"

# =============================================================================
# Ретеншн
# =============================================================================
# Архив классифицируется по дате из его имени (PREFIX-YYYY-MM-DD-*.tar.gz):
#   дневной  — все архивы за последние KEEP_DAILY календарных дней (включая сегодня);
#   недельный — один на неделю (Пн–Вс): самый ПОЗДНИЙ архив недели — при ежедневных
#              запусках это воскресный архив — для последних KEEP_WEEKLY недель,
#              включая текущую (итого покрытие ~2 месяца);
#   месячный — один на месяц: самый ПОЗДНИЙ архив месяца — при ежедневных запусках
#              это архив за последний день месяца — для последних KEEP_MONTHLY
#              месяцев, включая текущий.
# Один архив может закрывать несколько категорий — храним его один раз
# (keep — множество). Файлы с нечитаемой датой в имени НЕ удаляются (только WARN).
# =============================================================================

today=$(date '+%F')
# Граница дневного окна: today-13 => ровно KEEP_DAILY календарных дней
daily_cutoff=$(date -d "$today - $((KEEP_DAILY - 1)) days" '+%F')
# Понедельник текущей недели (%u = 1..7, Пн..Вс) и старт недельного окна
this_monday=$(date -d "$today - $(( $(date '+%u') - 1 )) days" '+%F')
weekly_start=$(date -d "$this_monday - $(( (KEEP_WEEKLY - 1) * 7 )) days" '+%F')
# Старт месячного окна: от 1-го числа текущего месяца (безопасно для конца месяца)
monthly_start=$(date -d "${today:0:7}-01 - $((KEEP_MONTHLY - 1)) months" '+%Y-%m')

tmp=$(mktemp)
# Список «дата|путь» всех архивов, сортировка по дате
for f in "$BACKUP_DIR/${ARCHIVE_PREFIX}"-*.tar.gz; do
  [ -e "$f" ] || continue                    # маска не совпала ни с одним файлом
  base=$(basename "$f")
  d=${base#"${ARCHIVE_PREFIX}-"}             # YYYY-MM-DD-HHMM.tar.gz
  d=${d:0:10}                                # YYYY-MM-DD
  if ! date -d "$d" '+%F' >/dev/null 2>&1 || [ "${d:4:1}${d:7:1}" != "--" ]; then
    log "WARN: не разобрал дату в имени '$base' — файл не трогаю"
    continue
  fi
  printf '%s|%s\n' "$d" "$f"
done | sort > "$tmp"

# Якоря недель/месяцев: в каждой неделе и месяце запоминаем самый поздний архив
declare -A week_date=() week_file=() month_date=() month_file=()
while IFS='|' read -r d f; do
  [ -n "$d" ] || continue
  # Понедельник недели, к которой относится дата d
  monday=$(date -d "$d - $(( $(date -d "$d" '+%u') - 1 )) days" '+%F')
  m=${d:0:7}
  if [ -z "${week_date[$monday]:-}" ] || [[ "$d" > "${week_date[$monday]}" ]]; then
    week_date[$monday]="$d"; week_file[$monday]="$f"
  fi
  if [ -z "${month_date[$m]:-}" ] || [[ "$d" > "${month_date[$m]}" ]]; then
    month_date[$m]="$d"; month_file[$m]="$f"
  fi
done < "$tmp"

# Множество архивов, которые оставляем
declare -A keep=()
n_daily=0; n_weekly=0; n_monthly=0

# 1) Дневные: всё внутри дневного окна
while IFS='|' read -r d f; do
  [ -n "$d" ] || continue
  if [[ "$d" > "$daily_cutoff" || "$d" == "$daily_cutoff" ]]; then
    keep[$f]=1; n_daily=$((n_daily + 1))
  fi
done < "$tmp"

# 2) Недельные: якорь каждой недели из недельного окна
for monday in "${!week_file[@]}"; do
  if [[ "$monday" > "$weekly_start" || "$monday" == "$weekly_start" ]]; then
    keep["${week_file[$monday]}"]=1; n_weekly=$((n_weekly + 1))
  fi
done

# 3) Месячные: якорь каждого месяца из месячного окна
for m in "${!month_file[@]}"; do
  if [[ "$m" > "$monthly_start" || "$m" == "$monthly_start" ]]; then
    keep["${month_file[$m]}"]=1; n_monthly=$((n_monthly + 1))
  fi
done

# Удаляем всё, что не попало ни в одну категорию
n_deleted=0
while IFS='|' read -r d f; do
  [ -n "$d" ] || continue
  if [ -z "${keep[$f]:-}" ]; then
    rm -f "$f"
    log "Ретеншн: удаляю $(basename "$f") (от $d)"
    n_deleted=$((n_deleted + 1))
  fi
done < "$tmp"

n_kept=${#keep[@]}
log "Ретеншн: удалено $n_deleted; храним $n_kept архивов (в окнах: дневных $n_daily, недельных $n_weekly, месячных $n_monthly)"

tg_send "✅ GymHelper backup OK: $(basename "$ARCHIVE") ($SIZE); по ретеншну удалено: $n_deleted, храним: $n_kept"
log "Бэкап успешно завершён"
exit 0
