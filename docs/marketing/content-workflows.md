# Конвейер подготовки SMM-контента GymHelper — гайд владельцу

Дата: 25.11.2026. Тикет: [PRO-T3] (https://github.com/PolkAlex/gymhelper/issues/401).
Стратегия и каналы: `promotion-research-2026-11.md`. Публикация — вручную владельцем
(автопостинг запрещён решением владельца).

## Решения владельца по контенту (25.11.2026)

- **Голос**: безличный бренд, продукт в третьем лице, от лица основателя не пишем;
  к читателю на «ты»; истории от первого лица — только голос анонимного спортсмена.
- **Reels без озвучки**: текст на экране + автосубтитры CapCut + музыка из библиотеки
  Instagram; сценарии не писать под закадровый голос.
- **Cookies для video-analyzer** (Instagram/TikTok конкурентов) — позже, по потребности.
- **MCPollinations** — оставить (репо архивирован, генерация работает); замена — при поломке.

## Что подключено (opencode.json → mcp.servers)

| MCP | Что делает | Кому доступен |
|---|---|---|
| `playwright` | живой браузер: проверка вёрстки Mini App, просмотр публичных страниц | все агенты |
| `pollinations` | генерация картинок/текста/аудио (Pollinations, без ключа) | все агенты |
| `yt-transcript` | транскрипты YouTube (нативные субтитры, RU работает) | все агенты |
| `video-analyzer` | метаданные/кадры/OCR видео; транскрипт YouTube (м.б. 429 rate-limit); для Instagram/TikTok нужны yt-dlp + cookies | все агенты |
| `free-seo` | keyword research: автоподсказки Google, тренды, Reddit (ключи Bing/ScrapeCreators не подключены) | все агенты |

Статус подключения проверять: `opencode mcp list`.

## Скиллы (`.opencode/skill/`)

| Скилл | Когда использовать |
|---|---|
| `sm-strategy` | контент-план на неделю, сценарий Reels с тайм-кодами, хуки |
| `sm-captions` | подпись ≤900 знаков с вопросом + 5 хештегов (2+2+1) |
| `ig-carousel` | карусель PNG 1080×1350 (HTML → Playwright), тёмная тема GymHelper |
| `sm-research` | тренды ниши, разбор конкурентов, язык аудитории |
| `avoid-ai-writing` | вычитка ЛЮБОГО текста перед передачей владельцу |

Агент собирает полный пакет (сценарий + карусель + подпись + хештеги) одним прогоном:
попросить «собери контент-пакет по теме X» — скиллы цепляются по описаниям.
Образец готового пакета: `samples/2026-11-25-1pm/`.

## Воркфлоу В1–В4 (из promotion-research-2026-11.md, раздел 8)

Промпты писались для внешних чат-ботов (DeepSeek/Qwen/Алиса), но в OpenCode то же
делается одной фразой — агент использует скиллы и MCP из таблиц выше.

| Воркфлоу | Промпт из исследования | Что сказать агенту OpenCode |
|---|---|---|
| **В1. Идеи постов на неделю** | «Ты SMM-редактор. Продукт: GymHelper… 7 идей по ролям: 2 пользы, 2 продукта, 1 соцдоказательство, 1 мотивация, 1 интерактив…» | «Составь контент-план на неделю» → скилл `sm-strategy` (роли и хуки уже зашиты) |
| **В2. Сценарий Reels 15–30 сек** | «Напиши сценарий Reels на 20 секунд. Тема: [тема]… 0–3 хук, 4–15 суть, 16–20 CTA; текст на экране ≤6 слов; план съёмки с телефона…» | «Сделай сценарий Reels по теме X + план съёмки» → `sm-strategy`; при желании добавить кадры референсов — `sm-research` |
| **В3. Рерайт под тон бренда** | «Перепиши в стиле примеров. Третье лицо про продукт, без ты/вы, короткие фразы, факты без обещаний…» | «Перепиши текст в тон GymHelper и програй по avoid-ai-writing» → `avoid-ai-writing` (правила тона уже в скилле) |
| **В4. Хештеги и описание** | «К посту [вставить] дай описание до 900 знаков с вопросом в конце; 5 хештегов: 2 широких, 2 узких, 1 нишевый…» | «Подпись и хештеги к посту X» → `sm-captions`; свежие подсказки аудитории — MCP `free-seo` |

## Типовые команды агенту (копировать в чат OpenCode)

- «Собери контент-пакет по теме [тема]: сценарий Reels 20 сек, карусель 4 слайда,
  подпись с вопросом, 5 хештегов. Артефакты — в docs/marketing/samples/<дата>-<тема>/»
- «Разбери это видео конкурента: <URL>» → yt-transcript / video-analyzer (транскрипт +
  метаданные, что сработало в хуке и структуре)
- «Какие запросы вокруг темы X вводят люди?» → free-seo: suggest / expand_questions
- «Сгенерируй обложку/постер для поста про X» → pollinations (картинка сохранится файлом;
  Pollinations отдаёт JPEG — переименовать .png → .jpg)
- «Вычитай текст» → avoid-ai-writing

## Ограничения и известные особенности

1. `video-analyzer` для YouTube/Instagram/TikTok требует yt-dlp — он установлен во
   временную папку (`%TEMP%\opencode\mcptools\pyvenv`); в `opencode.json` эта папка
   добавлена **в начало унаследованного PATH** (подстановка `{env:PATH}` — проверено
   живым вызовом). Версия сервера зафиксирована: `mcp-video-analyzer@0.12.0`.
   Если node или yt-dlp переедут в другое место — править только путь pyvenv в
   `opencode.json` (узнать: `where yt-dlp`, `where node`).
   Instagram обычно требует cookies (экспорт в файл, env `YTDLP_COOKIES`) — делается
   руками владельца, когда понадобится разбор Reels.
2. Транскрипты YouTube упираются в rate-limit (HTTP 429) при частых запросах —
   подождать и повторить; без нативных субтитров локальная расшифровка недоступна
   (Whisper требует GPU/ключ OpenAI — не подключено).
3. MCPollinations: файлы называются `.png`, но содержимое JPEG. Текстовая генерация
   этого сервера может быть нестабильна (сервер архивирован автором) — тексты пишут
   агенты, картинки генерирует Pollinations.
4. Все локальные зависимости MCP живут в `%TEMP%\opencode\mcptools\` (НЕ в репо).
   Если папку почистили — переустановка описана в разделе ниже.
5. Не подключено (решения владельца): posting-MCP (автопостинг запрещён), ScrapeCreators
   API (квоты не проверены), instapdown/Trends-MCP/HasData (free-лимиты не подтверждены),
   ComfyUI (нет GPU), ключ TwelveLabs/Bing/Apify (не требуются базовыми сценариями).

## Переустановка локальных MCP после чистки TEMP

```powershell
# yt-dlp (для video-analyzer)
python -m venv "$env:TEMP\opencode\mcptools\pyvenv"
& "$env:TEMP\opencode\mcptools\pyvenv\Scripts\python.exe" -m pip install yt-dlp

# yt-transcript (локальная обёртка): код берём из РЕПО tools/ytlib/, не рукописаем
New-Item -ItemType Directory -Force -Path "$env:TEMP\opencode\mcptools\ytlib" | Out-Null
Copy-Item "tools\ytlib\yt-transcript-mcp.mjs" "$env:TEMP\opencode\mcptools\ytlib\" -Force
Set-Location "$env:TEMP\opencode\mcptools\ytlib"
npm init -y; npm install youtube-transcript

# free-seo-mcp
git clone --depth 1 https://github.com/JohnWayneeee/free-seo-mcp.git "$env:TEMP\opencode\mcptools\free-seo-mcp"
python -m venv "$env:TEMP\opencode\mcptools\free-seo-venv"
& "$env:TEMP\opencode\mcptools\free-seo-venv\Scripts\python.exe" -m pip install "$env:TEMP\opencode\mcptools\free-seo-mcp"
```

Пути в `opencode.json` (mcp.servers) уже указывают на эти папки; yt-dlp подключается
через `{env:PATH}`-препенд к унаследованному PATH.
