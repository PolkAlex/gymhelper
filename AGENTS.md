# AGENTS.md — правила проекта MyHelper (GymHelper)

Telegram-бот дневника тренировок. Backend: чистая **Java 17 без внешних зависимостей** (`src/gym/`).
Frontend: Telegram Mini App — ванильный JS/HTML/CSS (`web/`), без сборки и npm-пакетов.
Тесты: Playwright e2e + контрактный тест на Java. Подробности — `README.md`.
Заметки владельца — `TODO.md` (проверять в начале любой задачи).

## Структура

```
src/gym/*.java             — бот (Main, BotLogic, TelegramApi, Json, GymData, Storage, ...)
src/gym/web/WebServer.java — HTTP-сервер Mini App (порт 8080)
web/                       — фронтенд Mini App (app.js, catalog.js, style.css, index.html)
tests/                     — e2e.spec.js (Playwright), GymContractTest.java, check.js, server-test.js
.github/                   — CI-воркфлоу, шаблоны issue/PR
docs/                      — спецификации и макеты дизайнера, карта покрытия тестами
data/                      — данные пользователей (JSON на чат) — НЕ коммитить
build.gradle, gradlew      — сборка Gradle (код остаётся чистой Java без зависимостей)
Dockerfile, docker-compose.yml — контейнер для VPS (deploys вручную, systemd ещё жив)
```

## Команды (PowerShell, из корня проекта)

```powershell
# ОСНОВНОЙ ПУТЬ — Gradle: компиляция + jar + контрактный тест одним словом
.\gradlew.bat --no-daemon build          # сборка + проверка (check включает contractTest)
.\gradlew.bat --no-daemon contractTest   # только контрактный тест формата данных
java -jar build\libs\gymhelper-1.0.0.jar # запуск собранного jar

# точечная компиляция без Gradle (fallback, если gradlew недоступен)
javac -encoding UTF-8 -d out (Get-ChildItem -Recurse src -Filter *.java).FullName
java -cp out gym.Main

# статические проверки JS
node --check web/app.js
node --check web/catalog.js
node tests/check.js

# e2e: тестовый сервер поднимется сам (порт 8099)
npx playwright test                        # все проекты устройств
npx playwright test --project=desktop      # только десктоп (быстрый прогон)
npx playwright test --project=iphone13     # iPhone 13, WebKit (~Safari)
```

⚠️ `test.bat` — то же самое для человека, но с `pause` в конце: агентам НЕ использовать
(зависнет в ожидании Enter).

## GitHub (gh CLI установлен и авторизован)

```powershell
gh auth status                             # проверка входа (аккаунт PolkAlex)
gh issue list / gh issue view N            # задачи; доска: https://github.com/users/PolkAlex/projects/1
gh issue create --label feature --title "..." --body "..."
gh project item-add 1 --owner PolkAlex --url <issue-url>   # добавить задачу на доску
```

- Метки: `bug`, `feature`, `infra`, `testing`
- Завершённую работу по задаче закрывайте: `gh issue close N --comment "что сделано"` (коммит с `fixes #N` закрывает сам)

### Статусы на доске (колонки = пайплайн)

| Статус | Смысл | option_id |
|---|---|---|
| Todo | не начато | `f75ad846` |
| In Design | работа с макетами и требованиями (агент design) | `0d6349bf` |
| In Dev | в работе у кодера | `47fc9ee4` |
| Code Review | проверка кода (агент reviewer) | `c01817f5` |
| In Test | в тестировании (агент tester) | `80c8b987` |
| Ready To Deploy | тесты зелёные, ждёт выкатки на прод | `818ca3c4` |
| Done | доставлено на прод | `98236657` |

Порядок: In Design → In Dev → Code Review → In Test → Ready To Deploy → Done
(ревью ДО тестов; блокер ревью/тестов возвращает задачу в In Dev).

Двигать item по статусам:

```powershell
# узнать item-id задачи: gh project item-list 1 --owner PolkAlex
gh project item-edit --id <ITEM_ID> --project-id PVT_kwHOChl8UM4BqICL `
  --field-id PVTSSF_lAHOChl8UM4BqICLzhoggh4 --single-select-option-id <OPTION_ID>
```

## Конвенции

- Java 17, **никаких внешних зависимостей в коде** (Gradle — только инструмент сборки,
  никаких Maven-зависимостей в build.gradle)
- `web/` — ванильный JS/CSS/HTML: без фреймворков, сборщиков и новых npm-пакетов
- Формат данных `data/*.json` (класс `GymData`) — **обратная совместимость обязательна**:
  старые файлы без новых полей должны читаться (эталон — `GymContractTest`)
- Все тексты интерфейса — на русском
- Стиль кода — как в соседних файлах; минимальные диффы, рефакторинг без просьбы не делать
- Пол пользователя хранится как `м`/`ж`

## Безопасность

- **НИКОГДА** не читать, не печатать в чат и не коммитить: `token.txt`, `deploy_key`, `deploy_key.pub`
- Не коммитить: `data/`, `out/`, `testout/`, `node_modules/`, `test-results/`

## Роли агентов

| Агент | Роль |
|---|---|
| lead | Диспетчер: ведёт задачу по конвейеру design → coder → tester → reviewer |
| design | Спецификации в `docs/` и HTML/SVG-макеты в `docs/mockups/`; код не трогает |
| coder | Код: `src/gym/` и `web/` |
| tester | e2e-сценарии поведения пользователя + юнит-тесты Java; карта покрытия `docs/test-plan.md` |
| reviewer | Ревью диффа; только читает |
