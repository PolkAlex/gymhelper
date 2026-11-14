#!/bin/sh
# =============================================================================
# ana-export.sh — выгрузка ANA-агрегатов /stats на VPS ([ANA-T4], issue #231)
# Кладётся lead'ом в /opt/gym/ana-export.sh (в контейнер/деплой не входит).
# Запуск (на VPS или по ssh из tools/ana-pull.ps1):
#   sh /opt/gym/ana-export.sh
#
# Что делает: читает GYM_ADMIN_TOKEN из /opt/gym/.env (НЕ печатает его),
# забирает http://localhost:8080/stats?token=… и кладёт ответ в
# /tmp/ana-stats.json (chmod 600 — читать может только root). В JSON только
# агрегаты счётчиков, без ПДн (privacy.html).
#
# Fail-safe: ошибка curl / пустой ответ / не-JSON → файл не пишется,
# exit 1 с сообщением. Дальше файл забирает tools/ana-pull.ps1 (с локальной
# машины) → tools/ana-to-gist.mjs → secret gist → Grafana Cloud.
# =============================================================================

set -u
APP_DIR=/opt/gym
OUT=/tmp/ana-stats.json

cd "$APP_DIR" 2>/dev/null || { echo "ОШИБКА: нет каталога $APP_DIR" >&2; exit 1; }

# токен из .env: первая строка GYM_ADMIN_TOKEN=…; значение может содержать '=',
# поэтому -f2- ; tr -d '\r' — защита от CRLF, если .env правили из Windows
TOKEN=$(grep '^GYM_ADMIN_TOKEN=' .env 2>/dev/null | head -n 1 | cut -d= -f2- | tr -d '\r')
if [ -z "${TOKEN:-}" ]; then
    echo "ОШИБКА: GYM_ADMIN_TOKEN не найден в $APP_DIR/.env" >&2
    exit 1
fi

rm -f "$OUT"
# -s тихо; -f: HTTP >= 400 (неверный токен → 404) = ненулевой код, тело не пишем;
# --max-time 30: зависший порт не вешает скрипт. Сообщение об ошибке — своё,
# без URL (токен в query, в консоль его не печатаем).
CURL_CODE=0
curl -s -f --max-time 30 "http://localhost:8080/stats?token=$TOKEN" -o "$OUT" || CURL_CODE=$?
if [ "$CURL_CODE" -ne 0 ]; then
    echo "ОШИБКА: curl /stats завершился с кодом $CURL_CODE (контейнер на 8080 не отвечает или токен неверен) — файл не пишу" >&2
    rm -f "$OUT"
    exit 1
fi

if [ ! -s "$OUT" ]; then
    echo "ОШИБКА: /stats вернул пустой ответ — файл не пишу" >&2
    rm -f "$OUT"
    exit 1
fi

FIRST=$(head -c 1 "$OUT" 2>/dev/null)
if [ "$FIRST" != "{" ]; then
    echo "ОШИБКА: ответ /stats не похож на JSON — файл не пишу" >&2
    rm -f "$OUT"
    exit 1
fi

chmod 600 "$OUT"
echo "OK: $OUT ($(wc -c < "$OUT") байт)"
