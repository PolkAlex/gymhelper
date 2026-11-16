---
name: board
description: Управление тикетами на доске GitHub Projects MyHelper — движение статусов, синхронизация родителей с детьми, спринты, запись метрик. Использовать при любом изменении статуса тикета и при переносе задач между колонками.
---

# Доска GitHub Projects (PolkAlex/projects/1)

- project-id: `PVT_kwHOChl8UM4BqICL`
- field-id Status: `PVTSSF_lAHOChl8UM4BqICLzhoggh4`
- **option_id статусов и id всех остальных полей — таблицы в AGENTS.md** (единый
  источник правды; option_id пересоздаются при любом изменении набора опций поля).

## Движение тикета по статусу

1) Узнать item-id тикета:

   ```powershell
   gh project item-list 1 --owner PolkAlex
   ```

2) Сменить статус:

   ```powershell
   gh project item-edit --id <ITEM_ID> --project-id PVT_kwHOChl8UM4BqICL `
     --field-id PVTSSF_lAHOChl8UM4BqICLzhoggh4 --single-select-option-id <OPTION_ID>
   ```

3) **При каждом переходе** (правило владельца, п.17 AGENTS.md) — строка в
   `docs/metrics-log.md` (дата, тикет, из → в), затем обновить дашборд:

   ```powershell
   node tools/metrics-to-json.mjs
   # далее gh gist edit по инструкциям docs/metrics.md, раздел «Дашборд»
   ```

## Правила движения (сводка)

- Порядок: Todo → (In Design — только для `need_design`) → In Dev → Code Review →
  In Test → Ready To Deploy → Done. Ревью ДО тестов.
- Блокер ревью/тестов возвращает тикет в In Dev.
- Статус меняет lead в момент передачи работы следующему агенту.
- **Родители синхронно с детьми**: все дети в статусе X → родителя в X; хоть один
  ребёнок отстаёт → родитель остаётся на месте.
- **Спринт** (field-id `PVTIF_lAHOChl8UM4BqICLzhos4e4`) обязателен каждому тикету,
  взятому в работу, — всей семье, включая Epic и Idea-контейнер. Итерация текущего
  спринта: `gh project field-list 1 --owner PolkAlex`.
- Todo = только взятые в текущий спринт; остальное живёт в Backlog.
- Спринт закрывается строго по дате (14 дней), досрочно — только явное решение владельца.
- «Готово по тикету» ≠ «спринт закрыт» (терминология, п.16 AGENTS.md).

## Технические грабли (PowerShell + gh)

- GraphQL-мутации НЕ собирать инлайном: bash-слой съедает кавычки. Писать mutation
  в JSON-файл (Write tool) и запускать `gh api graphql --input файл`.
- `--jq` надёжнее ручного парсинга вывода.
- `gh project item-delete` требует и номер проекта, и `--id`: 
  `gh project item-delete 1 --owner PolkAlex --id <ITEM_ID>`.
