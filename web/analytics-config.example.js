'use strict';
/* [PRO-T1] Конфиг Telegram Mini Apps Analytics SDK (Telegram Apps Center требует analytics).
   ЭТОТ ФАЙЛ — ШАБЛОН: скопируйте его в web/analytics-config.js и заполните значения.
   web/analytics-config.js — в .gitignore (как token.txt): токен аналитики не коммитится.

   Где взять значения:
   - token: SDK-токен Telegram Analytics — выдаётся через TON Builders / @DataChief_bot
     (https://docs.tganalytics.xyz), один на приложение;
   - appName: идентификатор приложения из того же бота (латиницей, например 'gymhelper').

   Прод (Docker на VPS): web/ запечён в образ, поэтому файл подкладывается volume-маунтом
   в docker-compose.yml на VPS:
     - ./analytics-config.js:/app/web/analytics-config.js:ro
   (положить файл рядом с docker-compose.yml на VPS; сам docker-compose.yml в репозитории
   не менялся — маунт добавляется владельцем при выдаче токена).
   Если файла нет / token пуст — SDK не инициализируется, приложение работает как раньше. */

window.tmaAnalyticsConfig = window.tmaAnalyticsConfig || {
    token: '',    /* SDK Auth token из @DataChief_bot */
    appName: ''   /* analytics identifier из @DataChief_bot */
};
