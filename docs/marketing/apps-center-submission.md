# Подача GymHelper в Telegram Apps Center — черновик пакета [PRO-T2]

Статус: черновик lead'а, ждёт analytics ID (шаг владельца) и скриншотов.

## Порядок подачи (механика каталога)

1. Владелец: открыть https://tapps.center → войти под своим Telegram-аккаунтом →
   зарегистрировать приложение (ссылка на бота: https://t.me/MyHelperGymBot/app) →
   получить **analytics ID/токен** для Telegram Mini Apps Analytics.
2. Владелец передаёт токен lead'у (в чат НЕ выкладывать — можно файлом/лично).
3. Lead: кладёт токен в `web/analytics-config.js` (формат — см. analytics-config.example.js),
   маунтит файл на VPS в контейнер (по инструкции из example), бампает `?v=2` в index.html
   (заглушка закэширована клиентам на год — бамп обязателен), мини-деплой.
4. Проверка: открыть Mini App → `__gym.tmaState() === 'ok'` (или счётчик запусков в кабинете).
5. Подача через **@app_moderation_bot**: ссылка → analytics ID → подзаголовок → описание → скриншоты.
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
