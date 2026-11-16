---
name: new-ticket
description: Создание тикетов и семей тикетов MyHelper (Idea→Epic→Story→Task) с кодами [ABC-XN], направлением, приоритетом, спринтом и sub-issues. Использовать при оформлении новой задачи или идеи на доске.
---

# Создание тикета / семьи на доске

## Иерархия

Idea → Epic → Story → Task (уровни НЕ пропускать). Мелкая идея → Epic вырождается
в одну одноимённую Story с одним Task. Разовая работа без идеи — одиночный Task
или Bug без родителя. Bug — вне иерархии.

## Шаги

1) Код направления (3 буквы) и таблица option_id — AGENTS.md (поле «Направление»,
   field-id `PVTSSF_lAHOChl8UM4BqICLzhohnTs`). Новое направление → владелец/lead
   заводит новую опцию, после чего обновить таблицу id в AGENTS.md.

2) Код тикета в заголовке: `[ABC-XN] Название`, где X = I/E/S/T/B (тип), N —
   следующий номер тикета ЭТОГО типа внутри направления. Код ставит lead.

3) Создать issue:

   ```powershell
   gh issue create --title "[MON-E1] ..." --body "..."
   # метки-атрибуты при необходимости: need_design, auto_test, tech, documentation
   ```

   Старые метки bug/feature/infra/testing для новых задач НЕ использовать.

4) Добавить на доску:

   ```powershell
   gh project item-add 1 --owner PolkAlex --url <issue-url>
   ```

5) Проставить поля (item-id из `gh project item-list 1 --owner PolkAlex`):
   - Тип — field-id `PVTSSF_lAHOChl8UM4BqICLzhohSIQ`, option_id из AGENTS.md;
   - Направление — всей семье одна опция (цвет = семья);
   - Приоритет — `PVTF_lAHOChl8UM4BqICLzhok_ho`, число 1–100 (1 — высший);
   - Спринт — `PVTIF_lAHOChl8UM4BqICLzhos4e4`, итерация текущего спринта
     (`gh project field-list 1 --owner PolkAlex`); проставляется при взятии в
     работу ВСЕЙ семье, включая Epic и Idea-контейнер;
   - Story Points — `PVTF_lAHOChl8UM4BqICLzhotCMg`, только эпики; оценку
     предлагает lead, утверждает владелец.

6) Sub-issues: потомки заводятся как отдельные issue, родитель связывается полем
   Parent issue (нативный GitHub). На доске виден Sub-issues progress.

7) Idea-контейнер остаётся Тип=Idea в Backlog до Done всех потомков, потом
   закрывается. По конвейеру едут только потомки.

## Статусы по типам

- Task/Bug — полный конвейер (Inbox не используется).
- Epic/Story — статус = состояние детей (Design/Test-статусы не используются).
- Idea — Backlog.

## Напоминание

Создание тикетов ≠ запуск работы: код/дизайн/тесты стартуют только по явной
команде владельца на конкретный тикет (п.13 AGENTS.md). Оценка времени владельцу —
поэтапно: кодер ~X, ревью ~Y, тесты ~Z.
