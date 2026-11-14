#!/usr/bin/env node
/* ana-to-gist.mjs — выгружает продуктовые агрегаты /stats [ANA-T2] в компактный JSON
   для Grafana Cloud (Infinity): { generatedAt, source, totals, weeks[] }. Только счётчики —
   без ПДн (privacy.html). Зависимостей нет (чистый node, по образцу metrics-to-json.mjs).
   Требуется Node 18+ (глобальный fetch). Источник — первый доступный:
     1) env GYM_STATS_URL + GYM_ADMIN_TOKEN   → GET <GYM_STATS_URL>/stats?token=…
        (fetch с AbortSignal.timeout(30000): зависший URL не вешает скрипт — [ANA-T3])
     2) путь к stats.json: аргумент → env GYM_STATS_FILE → data/stats.json
   Запуск:  node tools/ana-to-gist.mjs [stats.json] [файл-выхода]
   По умолчанию выход: %TEMP%/opencode/ana-stats.json.
   Гист скрипт НЕ создаёт: одноразовые команды и настройка Infinity — docs/metrics.md
   (раздел «ANA-дашборд»); токены в консоль не печатаются. */

import fs from "node:fs";
import path from "node:path";

/* известные ключи — синхронизированы с Stats.KEYS (src/gym/Stats.java) */
const KEYS = ["maInit", "maSave", "workoutsCreated", "workoutsCompleted", "templatesCreated", "templatesUsed", "feedbackSent"];

const outArg = process.argv[3] || path.join(process.env.TEMP || "/tmp", "opencode", "ana-stats.json");
const fail = (msg) => { console.error("ОШИБКА: " + msg); process.exit(1); };

/* все 7 ключей (отсутствующий/мусорный → 0) — формат недельных агрегатов совпадает с totals */
const counters = (m) => {
  const src = m && typeof m === "object" ? m : {};
  const out = {};
  for (const k of KEYS) {
    const n = Number(src[k]);
    out[k] = Number.isFinite(n) ? n : 0;
  }
  return out;
};

const baseUrl = (process.env.GYM_STATS_URL || "").trim();
const adminToken = (process.env.GYM_ADMIN_TOKEN || "").trim();
let raw = null;
let source;

if (baseUrl && adminToken) {
  /* базовый адрес (домен) → /stats?token=…; задан уже полный путь …/stats — используем как есть */
  const u = baseUrl.replace(/\/+$/, "") + (baseUrl.endsWith("/stats") ? "" : "/stats");
  try {
    /* [ANA-T3] таймаут 30 с: зависший прод-URL не вешает скрипт */
    const resp = await fetch(u + "?token=" + encodeURIComponent(adminToken), { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) fail("HTTP " + resp.status + " от " + u + (resp.status === 404 ? " (неверный GYM_ADMIN_TOKEN?)" : ""));
    raw = await resp.json();
    source = "GYM_STATS_URL";
    console.log("источник: " + u + " (env GYM_STATS_URL)");
  } catch (e) {
    const isTimeout = e && (e.name === "TimeoutError" || e.name === "AbortError");
    fail("не удалось получить " + u + ": " + (isTimeout ? "таймаут 30 с (AbortSignal.timeout)" : e.message));
  }
} else {
  if (baseUrl || adminToken) {
    console.log("[warn] задан только один из GYM_STATS_URL / GYM_ADMIN_TOKEN — беру локальный файл");
  }
  const srcArg = process.argv[2] || process.env.GYM_STATS_FILE || "data/stats.json";
  try {
    /* trim() снимает BOM, если stats.json правили из Windows-редактора/PowerShell */
    raw = JSON.parse(fs.readFileSync(srcArg, "utf8").trim());
    source = srcArg;
    console.log("источник: " + srcArg + " (локальный файл)");
  } catch (e) {
    fail("источник не задан: GYM_STATS_URL + GYM_ADMIN_TOKEN не установлены, файл " + srcArg + " не читается (" + e.message + ")");
  }
}

/* weeks: { "2026-W46": {…} } → массив по возрастанию недели (лексико-графически = хронологически) */
const weeksIn = raw && raw.weeks && typeof raw.weeks === "object" ? raw.weeks : {};
const weeks = Object.keys(weeksIn).sort().map((w) => ({ week: w, ...counters(weeksIn[w]) }));

const result = {
  generatedAt: new Date().toISOString(),
  source,
  totals: counters(raw),
  weeks,
};

fs.mkdirSync(path.dirname(outArg), { recursive: true });
fs.writeFileSync(outArg, JSON.stringify(result), "utf8");
console.log("OK ->", outArg);
console.log("weeks=" + weeks.length + " maInit=" + result.totals.maInit + " maSave=" + result.totals.maSave);
console.log("");
console.log("Обновление секретного гиста (после каждой выгрузки):");
console.log('  gh gist edit <GIST_ID> --filename ana-stats.json "' + outArg + '"');
console.log("Гиста ещё нет — создать ОДНОРАЗОВО (id вписать в docs/metrics.md, раздел «ANA-дашборд»):");
console.log('  gh gist create -d "GymHelper ANA stats (Grafana Infinity)" "' + outArg + '"');
