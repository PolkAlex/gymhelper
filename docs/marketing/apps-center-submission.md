# Подача GymHelper в Telegram Apps Center — черновик пакета [PRO-T2]

Статус: черновик lead'а, ждёт analytics ID (шаг владельца) и скриншотов.

## ⚠️ Статус канала (27.11.2026 — проверено живьём)

tapps.center перевёл сайт в режим «Something new is coming» — веб-форма приёма заявок
закрыта, витрина показывает TON-экосистему. **Важно: tapps.center — НЕ официальный
каталог Telegram**, а community-проект (описание @tapps_bot: «Community-driven catalog…
Not affiliated with Telegram Messenger», ~51k юзеров/мес). Актуальный вход — боты:

- **@app_moderation_bot** (Telegram Apps Moderation) — модерация/подача приложений
- **@tapps_bot** (Telegram Apps Center) — сам каталог

Шаг владельца: /start в @app_moderation_bot → следовать меню (там же обычно выдаётся
analytics ID для Telegram Mini Apps Analytics). Если меню отличается от ожиданий —
скриншот lead'у, скорректируем шаги. Альтернатива: спросить статус приёма у @tapps_bot.

## Порядок подачи (механика каталога — обновить по меню бота)

1. Владелец: /start в @app_moderation_bot → получить **analytics ID/токен**
   (Telegram Mini Apps Analytics) для приложения t.me/MyHelperGymBot/app.
2. Владелец передаёт токен lead'у (файлом/лично — в общий чат НЕ выкладывать).
3. Lead: кладёт токен в `web/analytics-config.js` (формат — см. analytics-config.example.js),
   маунтит файл на VPS в контейнер (по инструкции из example), бампает `?v=2` в index.html
   (заглушка закэширована клиентам на год — бамп обязателен), мини-деплой.
4. Проверка: открыть Mini App → `__gym.tmaState() === 'ok'` (или счётчик запусков в кабинете).
5. Подача через меню бота: ссылка → analytics ID → подзаголовок → описание → скриншоты.
6. Модерация 1–3 недели. После листинга — контроль прироста в /stats.

## Подзаголовок (≤60 знаков)

```
Workout diary: 1RM, records, 254 exercises — free, no signup
```
(58 знаков)

## Описание (EN, по образцу каталога)

```
GymHelper is your workout diary inside Telegram.

• Log sets and reps in seconds — the bot does the math
• Personal records and 1RM (Epley) calculated automatically
• 254 exercises with technique photos (224 with images)
• Rest timer, calendar, weekly stats
• No registration — open and train

Free forever. Built for gym and home workouts.
```

## Скриншоты 2–6 шт., 1080×2226 (9:19.5) — снимет lead (Playwright MCP)

Планы кадров: 1) ввод подхода (вес/повторы), 2) карточка рекорда 1ПМ, 3) календарь,
4) техника упражнения с фото, 5) таймер отдыха, 6) статистика недели.

## Риски/замечания

- SDK активируется только после шага 3 (до этого — заглушка, консоль чистая)
- Описание на EN — по образцу каталога; аудитория RU, но требования каталога — EN
- Privacy-строка про аналитику уже на проде (25.11) — требование раскрытия выполнено
- **Канальный риск:** tapps — community-проект и сейчас перестраивается; если приём
  заявок не откроется — канал откладывается, приоритет смещается на [PRO-T4]
  (Instagram, каталоги ботов, взаимопиар). SDK в проде безвреден (no-op) и будет
  ждать активации.
