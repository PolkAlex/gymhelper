# Бэкап data/ на VPS ([BAK-T1])

`backup.sh` упаковывает `/opt/gym/data` в архив `/opt/gym/backups/gym-data-YYYY-MM-DD-HHMM.tar.gz`
и делает ретеншн: **14 дневных + 8 недельных + 12 месячных** архивов (решение владельца, issue #16).
Опционально шлёт уведомление в Telegram. Запускается по расписанию через systemd timer —
ежедневно в 04:30 (`Persistent=true`: пропущенный запуск догоняется при старте сервера).

## Установка (root на VPS)

```bash
# 1. Положить скрипт (из клона репозитория) и сделать исполняемым
scp deploy/backup.sh root@45.91.169.125:/usr/local/bin/gym-backup.sh
ssh root@45.91.169.125 'chmod +x /usr/local/bin/gym-backup.sh'

# 2. Положить юниты systemd
scp deploy/backup.service deploy/backup.timer root@45.91.169.125:/etc/systemd/system/

# 3. На VPS: перечитать юниты и включить таймер
ssh root@45.91.169.125 'systemctl daemon-reload && systemctl enable --now backup.timer'
```

Пути в шапке скрипта (`DATA_DIR`, `BACKUP_DIR`, `ARCHIVE_PREFIX`, ретеншн `KEEP_*`, `LOG_FILE`)
уже настроены под прод (`/opt/gym/data` → `/opt/gym/backups`); менять не обязательно.

## Telegram-уведомления (опционально)

В шапке `/usr/local/bin/gym-backup.sh` заполнить:

```bash
TG_BOT_TOKEN="123456:ABC..."   # пусто = не отправлять
TG_CHAT_ID="123456789"
```

Подойдёт любой бот (можно тот же, что и GymHelper, — токен уже есть на VPS).
Не настроено/не дошло — скрипт не падает, только WARN в лог.

## Проверка

```bash
# Ручной запуск (или systemctl start backup.service)
/usr/local/bin/gym-backup.sh

# Что получилось
ls -lh /opt/gym/backups/
tail -20 /var/log/gym-backup.log

# Расписание
systemctl list-timers backup.timer
systemctl status backup.timer
journalctl -u backup.service -n 50
```

Exit-коды (можно вешать внешний мониторинг): `0` — успех, `1` — ошибка, `2` —
предыдущий запуск ещё не закончился (lock). Lock-файл: `/run/lock/gym-backup.lock`.

## Восстановление данных из архива

```bash
# 0. Посмотреть состав архива (внутри путь data/...)
tar -tzf /opt/gym/backups/gym-data-2026-11-04-0430.tar.gz | head

# 1. Остановить бота, чтобы он не писал в data/ во время восстановления
systemctl stop gymbot            # если бот под docker: docker compose stop gymbot

# 2а. Полное восстановление data/ (перезапишет текущий каталог!)
tar -xzf /opt/gym/backups/gym-data-2026-11-04-0430.tar.gz -C /opt/gym

# 2б. Или частично — достать один файл пользователя:
tar -xzf /opt/gym/backups/gym-data-2026-11-04-0430.tar.gz -C /tmp data/chat_<id>.json
cp /tmp/data/chat_<id>.json /opt/gym/data/chat_<id>.json

# 3. Запустить бота обратно
systemctl start gymbot           # docker compose start gymbot
```

⚠️ Внутри архива путь — `data/...` (относительно `/opt/gym`, без ведущего `/`), поэтому
`tar -xzf -C /opt/gym` восстанавливает ровно в `/opt/gym/data`. Если нужно поднять версию
отдельной тренировки,
есть ещё серверные бэкапы файлов пользователей: `/opt/gym/data/backups/chat_<id>.<timestamp>.json`
(20 последних версий, см. TODO.md).

## Что бэкапится

Полный снимок `data/` — включая `data/backups/` (версии файлов пользователей), поэтому
размер архива может быть заметно больше, чем текущий `data/` (примерно ×20 по объёму данных
активных пользователей). Для объёмов проекта это всё равно килобайты — оставлено осознанно:
полный снимок позволяет восстановить и «исторические» версии после потери сервера.
