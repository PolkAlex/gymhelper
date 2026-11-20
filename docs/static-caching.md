# Кэширование статики Mini App [UX-B17]

**Проблема:** до фикса вся статика отдавалась с `Cache-Control: no-store` — при каждом
открытии Mini App перекачивал ~660KB (app.js 361KB + catalog.js 175KB + style.css 99KB +
index.html 25KB) без сжатия → 3–7 секунд на мобильной сети.

**Схема (src/gym/web/WebServer.java, serveStatic):**

| Ресурс | Cache-Control | Почему |
|---|---|---|
| `index.html` (`/`, `/app`), `/landing/`, `/privacy.html` — все HTML | `no-cache` | входные точки без `?v=`; браузер ре-валидирует каждый раз, в index.html лежат ссылки на `?v=` |
| остальная статика: `app.js`, `style.css`, `catalog.js`, `/img/*`, `/landing/assets/*` | `public, max-age=31536000, immutable` | версии различаются `?v=`-бампом, имена img/ассетов неизменяемы |

Текстовая статика и API-ответы (html/js/css/json) отдаются через gzip при
`Accept-Encoding: gzip` (`Content-Encoding: gzip` + `Vary`, [EXR-T7]); 660KB → ~150KB.

## ОБЯЗАТЕЛЬНЫЙ кэш-бамп `?v=` на каждом релизе

Годовой immutable-кэш работает только при дисциплине версионирования:

- **Любое изменение** `web/app.js`, `web/style.css`, `web/catalog.js` → бамп `?v=` в
  `web/index.html` (ревьюер проверяет на каждом PR — релиз без бампа = устаревшая
  статика у всех пользователей до истечения max-age, т.е. до года).
- `telegram-web-app.js` отдаётся без `?v=` — при его обновлении тоже бампнуть ссылку
  в index.html (`telegram-web-app.js?v=N`).
- `index.html` и другие HTML менять можно свободно — они не кэшируются.

Проверка после деплоя: `curl -sI https://gym-helper.com/app.js | grep -i cache-control`
→ `immutable`; свежий контент — только после бампа `?v=` (иначе это кэш CDN/браузера).
