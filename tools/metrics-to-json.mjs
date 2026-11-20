#!/usr/bin/env node
/* metrics-to-json.mjs — генерирует metrics.json для дашборда Grafana из docs/metrics-log.md.
   Единственный источник данных — журнал (AGENTS.md п.17). Зависимостей нет (чистый node).
   Запуск:  node tools/metrics-to-json.mjs [путь-к-логу] [путь-выхода]
   По умолчанию: docs/metrics-log.md → %TEMP%/opencode/metrics.json */

import fs from "node:fs";
import path from "node:path";

const logArg = process.argv[2] || "docs/metrics-log.md";
const outArg = process.argv[3] || path.join(process.env.TEMP || "/tmp", "opencode", "metrics.json");
const md = fs.readFileSync(logArg, "utf8");

/* --- утилиты --- */
const clean = (s) => s.trim().replace(/^\*\*|\*\*$/g, "");
const isDash = (s) => !s || s === "—" || s === "-";
const isoDate = (s) => {
  s = (s || "").trim();
  if (isDash(s)) return null;
  let m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return s; // уже ISO или строка вида «до 06.11» — оставляем как есть
};
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null);

/* парсер markdown-таблицы после заголовка; первая строка (шапка) пропускается */
function tableAfter(headingRe) {
  const lines = md.split(/\r?\n/);
  let i = lines.findIndex((l) => headingRe.test(l));
  if (i < 0) return [];
  const rows = [];
  let headerSkipped = false;
  for (i = i + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l.startsWith("|")) {
      if (rows.length) break; // таблица закончилась
      continue; // пустые строки до таблицы
    }
    const cells = l.split("|").slice(1, -1).map(clean);
    if (cells.every((c) => /^[-: ]*$/.test(c))) continue; // разделитель
    if (!headerSkipped) { headerSkipped = true; continue; } // шапка
    rows.push(cells);
  }
  return rows;
}

/* --- реестр тикетов --- */
const RETURN_FROM = new Set(["Code Review", "In Test", "Ready To Deploy"]);
const tickets = tableAfter(/^### Реестр тикетов/).map((c) => {
  const [key, issue, type, epic, sp, cat, firstDev, rtd, done, ret] = c;
  const t = {
    key, issue: Number(issue), type, epic: isDash(epic) ? null : epic,
    sp: isDash(sp) ? null : Number(sp), category: isDash(cat) ? null : cat,
    firstDev: isoDate(firstDev), rtd: isoDate(rtd), done: isoDate(done),
    returns: Number(ret || 0),
  };
  t.ctDays = /^\d{4}-\d{2}-\d{2}$/.test(t.firstDev) && /^\d{4}-\d{2}-\d{2}$/.test(t.rtd)
    ? Math.max(daysBetween(t.firstDev, t.rtd), 0) : null;
  return t;
});

/* --- журнал переходов --- */
const transitions = tableAfter(/^### Журнал переходов/).map((c) => {
  const [date, tick, from, to, note] = c;
  return {
    date: isoDate(date), tickets: tick,
    from: isDash(from) ? null : from, to,
    note: note || "", isReturn: RETURN_FROM.has(from) && to === "In Dev",
  };
});

/* --- WIP-снимки --- */
const wip = tableAfter(/^### WIP-снимки/).map((c) => ({
  date: isoDate(c[0]), inDev: Number(c[1]), inCodeReview: Number(c[2]), inTest: Number(c[3]),
}));

/* --- спринты: заголовок "## Спринт N (dd.mm.yyyy – dd.mm.yyyy)" --- */
const sprints = [...md.matchAll(/^## (Спринт \d+) \((\d{2}\.\d{2}\.\d{4}) – (\d{2}\.\d{2}\.\d{4})\)/gm)]
  .map((m) => ({ name: m[1], start: isoDate(m[2]), end: isoDate(m[3]) }));

/* --- сводки по спринтам --- */
const inRange = (d, s) => d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= s.start && d <= s.end;
/* velocity: SP эпиков (строки реестра с type=Epic), достигших Done в окне спринта */
const velocity = sprints.map((s) => ({
  sprint: s.name, start: s.start, end: s.end,
  sp: tickets.filter((t) => t.type === "Epic" && inRange(t.done, s)).reduce((sum, t) => sum + (t.sp || 0), 0),
}));
const throughput = sprints.map((s) => ({
  sprint: s.name, start: s.start, end: s.end,
  count: tickets.filter((t) => inRange(t.done, s)).length,
}));
const returns = sprints.map((s) => ({
  sprint: s.name, start: s.start, end: s.end,
  count: transitions.filter((tr) => tr.isReturn && inRange(tr.date, s)).length,
}));
const ctByCategory = [];
for (const s of sprints) {
  for (const cat of ["S", "M", "L", "XL"]) {
    const list = tickets.filter((t) => t.epic && t.category === cat && inRange(t.rtd, s));
    const vals = list.map((t) => t.ctDays).filter((v) => v !== null);
    if (list.length) ctByCategory.push({
      sprint: s.name, category: cat, n: list.length,
      median: median(vals), mean: mean(vals),
    });
  }
}
/* escaped defects: ручная таблица «### Escaped defects» | Период | Кол-во | */
const escaped = tableAfter(/^### Escaped defects/).map((c) => ({
  period: c[0], count: Number(c[1]),
}));

const result = {
  generatedAt: new Date().toISOString(),
  source: "docs/metrics-log.md",
  sprints, tickets, transitions, wip,
  velocity, throughput, returns, ctByCategory, escaped,
};

fs.mkdirSync(path.dirname(outArg), { recursive: true });
fs.writeFileSync(outArg, JSON.stringify(result, null, 2), "utf8");
console.log("OK ->", outArg);
console.log(`tickets=${tickets.length} transitions=${transitions.length} sprints=${sprints.length} wip=${wip.length}`);
