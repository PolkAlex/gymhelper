# Миграция прода на Docker Compose (и откат назад)

Инструкция по переводу бота на VPS (`gym-vps`, Ubuntu 24.04) с systemd-юнита
`gymbot.service` на Docker Compose с образом из ghcr.io. Обратный откат на systemd
тоже описан — данные не теряются ни в одном направлении.

## Что получится

- Контейнер `gymbot` из образа **ghcr.io/polkalex/gymhelper:latest** (публикует CI на push в `main`).
- Compose-файл лежит в `/opt/gym/docker-compose.yml` (доставляется `scripts/deploy.ps1` по scp).
- Данные — там же, `/opt/gym/data` (volume `./data:/app/data`), как и раньше.
- Токен бота — `/opt/gym/.env`, строка `GYM_BOT_TOKEN=...`.
- URL кнопки Mini App — там же в `.env`, строка `GYM_WEBAPP_URL=...` (значение из `webapp.txt`).
- Порт слушается только на loopback: `127.0.0.1:8080`; наружу — nginx-прокси с HTTPS
  на `https://gym-helper.com` (сертификат Let's Encrypt на два имени: gym-helper.com +
  45.91.169.125.sslip.io, продлевается certbot-ом автоматически).

## Установка Docker на VPS

Системные пакеты Ubuntu, без внешних скриптов:

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
docker --version && docker compose version
```

⚠️ **На VPS 1 GB RAM (без swap) собирать образ НЕЛЬЗЯ** — сборка Java-проекта
не влезет в память. Только `docker compose pull` готового образа из ghcr.

## Доступ к приватному образу

Репозиторий приватный, образ в ghcr тоже приватный. Для pull нужен GitHub classic
PAT с правом **read:packages** на аккаунте PolkAlex (создать: GitHub → Settings →
Developer settings → Personal access tokens (classic)).

На VPS:

```bash
# --password-stdin: PAT не попадает в историю шелла и в вывод ps (обычный
# docker login с паролем-аргументом светит токен в обоих местах)
printf '%s' '<PAT>' | docker login ghcr.io -u PolkAlex --password-stdin
```

Docker сохранит учётку в `/root/.docker/config.json`. Никаких секретов в этот
документ не записываем.

## Подготовка /opt/gym

```bash
cd /opt/gym
# .env из существующих файлов (значения руками не копируем):
printf 'GYM_BOT_TOKEN=%s\n' "$(cat token.txt)" > .env
printf 'GYM_WEBAPP_URL=%s\n' "$(cat webapp.txt)" >> .env
chmod 600 .env
```

⚠️ Эти `printf`-команды выполняйте **на VPS внутри bash-скрипта** (не вставкой
через ssh из PowerShell): экранирование `\n` при передаче команды через слои
PowerShell → ssh может исказиться — вместо перевода строки в файл попадёт
литеральная `n`, и токен станет невалидным (Telegram ответит 401).
Реальный случай из миграции 05.11.2026: 61 байт «токен + n» вместо 62 байт
«токен + перевод строки» — диагностировалось по длине значения в контейнере.

`docker-compose.yml` попадёт на VPS при деплое через `scripts/deploy.ps1` (scp)
или вручную: `scp docker-compose.yml gym-vps:/opt/gym/`.

⚠️ **НЕ удалять `/opt/gym/out`, `/opt/gym/web` и `/opt/gym/token.txt`** — старые
class-файлы и статика нужны для быстрого отката на systemd (unit запускает
`java -cp out gym.Main`), а token.txt юнит читает как источник токена (без env);
без файла откат даст бота, который молча завершится на старте.

## Миграция (окно недоступности 2–5 минут)

```bash
# 1. Остановить systemd-бот
sudo systemctl stop gymbot

# 2. Запустить контейнер
cd /opt/gym && docker compose pull && docker compose up -d

# 3. Проверить здоровье (ждём ~10 секунд)
sleep 10
curl http://127.0.0.1:8080/health
# ждём {"ok":true,...,"chats":N}, chats > 0

# 4. Убрать gymbot из автозагрузки, чтобы он не поднялся при ребуте
#    рядом с compose (два бота на одних данных = беда)
sudo systemctl disable gymbot
```

Перед самой миграцией стоит выполнить финальный systemd-деплой
(`scripts/deploy.ps1`) — тогда `/opt/gym/out` и `/opt/gym/web`, оставшиеся для
отката, будут максимально свежими.

⚠️ Чем дольше живёте на Docker, тем старее код при откате на systemd. Данные это
не затрагивает — формат `GymData` один и тот же, откат ничего не потеряет,
но функциональность вернётся на уровень момента последнего systemd-деплоя.

## Откат на systemd (без потери данных)

```bash
cd /opt/gym && docker compose down

# вернуть владение данными: контейнер писал /opt/gym/data от root.
# Проверяем юнит — если задаёт User= (не root), делаем chown, иначе
# systemd-бот упадёт на записи данных
systemctl cat gymbot.service
# при наличии строки User=<user>:
sudo chown -R <user>:<user> /opt/gym/data

# данные /opt/gym/data не трогаются — общий каталог
sudo systemctl enable --now gymbot

curl http://127.0.0.1:8080/health   # ждём {"ok":true,...}
```

## Проверки после миграции

```bash
docker compose -f /opt/gym/docker-compose.yml ps        # контейнер Up (healthy)
docker compose -f /opt/gym/docker-compose.yml logs --tail 50   # без ошибок
curl http://127.0.0.1:8080/health                        # {"ok":true,...}
```

- Бот отвечает в Telegram (`/start`).
- В логах есть строка `Mini App menu button set: <URL>` — иначе кнопка Mini App
  не назначена (проверьте `GYM_WEBAPP_URL` в `.env`).
- Mini App открывается и сохраняет тренировки (данные из `data/` на месте —
  старые тренировки видны).
- В логах нет `HTTP 409 Conflict` — иначе где-то запущен второй инстанс бота
  с тем же токеном (проверьте другие машины: два поллера «рвут» друг другу
  апдейты и расшивают данные).

## Особенности

- **Перезапуск после ребута VPS**: Docker включён в автозагрузку
  (`systemctl enable docker`), а compose использует `restart: unless-stopped` —
  контейнер поднимется сам. Unit `gymbot.service` после миграции должен быть
  disabled (см. шаг 4 миграции).
- **Обновление версии**: `scripts/deploy.ps1` (или `-Yes` при подтверждённом
  деплое) — сам дождётся зелёного CI, обновит образ и проверит health.
- **Бэкапы**: `/opt/gym/data` и его ротация уже настроены и от способа запуска
  бота не зависят — работают одинаково под systemd и Docker.
