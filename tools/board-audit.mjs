#!/usr/bin/env node
/* board-audit.mjs — аудит порядка на доске GitHub Projects (PolkAlex/projects/1).
   Проверяет инварианты «Гигиены доски и тикетов» (AGENTS.md): обязательные поля,
   спринты пайплайна, синхрон борд↔issue, семьи (родители/дети), коды заголовков.
   Зависимостей нет; gh CLI должен быть авторизован.
   Запуск:  node tools/board-audit.mjs
   Код выхода: 0 — ок (допустимы warnings), 1 — есть blocker'ы. */

import { spawnSync } from "node:child_process";

const OWNER = "PolkAlex";
const REPO = "gymhelper";
const PROJECT = 1;
const PIPELINE = ["Todo", "In Design", "In Dev", "Code Review", "In Test", "Ready To Deploy"];
const TYPE_BY_CODE = { I: "Idea", E: "Epic", S: "Story", T: "Task", B: "Bug" };
const NO_DIR_OK = /^\[(TECH|DOC|APP)-/; // одиночные тех-тики без направления

const gh = (args, input) => {
  const r = spawnSync("gh", args, { encoding: "utf8", input: input || undefined });
  if (r.status !== 0) {
    console.error("gh failed:", args.join(" "), "\n", r.stderr);
    process.exit(2);
  }
  return r.stdout;
};
const gql = (query) => {
  const out = gh(["api", "graphql", "-f", `query=${query}`]);
  return JSON.parse(out).data;
};

/* --- доска --- */
const items = JSON.parse(gh(["project", "item-list", String(PROJECT), "--owner", OWNER, "--limit", "250", "--format", "json"])).items;
const byNumber = new Map();
for (const it of items) {
  const rec = {
    id: it.id,
    number: it.content?.number ?? null,
    title: it.title || "",
    status: it.status || null,
    type: null,
    dir: null,
    prio: null,
    sp: null,
    sprint: null,
    labels: it.labels || [],
  };
  for (const k of Object.keys(it)) {
    const v = it[k];
    if (["Idea", "Epic", "Story", "Task", "Bug"].includes(v)) rec.type = v;
    else if (typeof v === "number") rec.prio = rec.prio ?? v;
    else if (typeof v === "string" && k === "sprint") rec.sprint = v.title;
    else if (v && typeof v === "object" && v.iterationId) rec.sprint = v.title;
    else if (typeof v === "string" && !["Todo", "Backlog", "Inbox", ...PIPELINE, "Done"].includes(v) && v !== rec.title && k !== "title") rec.dir = rec.dir || null;
    else if (typeof v === "string" && ["Idea", "Epic", "Story", "Task", "Bug"].includes(v) === false && k.match(/[а-я]/i) && !["title"].includes(k)) { /* направление (кириллический ключ) */ if (rec.dir === null && v !== rec.type && Number.isNaN(Number(v))) rec.dir = v; }
  }
  // направление: ключ-имя поля кириллический («Направление»), значение — строка-опция
  if (rec.dir === null) {
    for (const k of Object.keys(it)) {
      if (["content", "id", "repository", "status", "title", "labels", "milestone", "sprint", "linked pull requests", "assignees", "story Points", "Тип", "Приоритет", "Type", "Priority", "Story Points"].includes(k)) continue;
      const v = it[k];
      if (typeof v === "string" && !["Idea", "Epic", "Story", "Task", "Bug"].includes(v)) { rec.dir = v; break; }
    }
  }
  // story points — числовое поле с именем "story Points"
  if (typeof it["story Points"] === "number") { rec.sp = it["story Points"]; rec.prio = rec.prio ?? null; }
  const prioKey = Object.keys(it).find((k) => k.includes("риоритет") || k === "Priority");
  if (prioKey && typeof it[prioKey] === "number") rec.prio = it[prioKey];
  const spKey = Object.keys(it).find((k) => k.includes("ory") && k.includes("oints"));
  if (spKey && typeof it[spKey] === "number") rec.sp = it[spKey];
  const dirKey = Object.keys(it).find((k) => k.includes("аправление") || k === "Direction");
  if (dirKey && typeof it[dirKey] === "string") rec.dir = it[dirKey];
  const typeKey = Object.keys(it).find((k) => k === "Тип" || k === "Type");
  if (typeKey && typeof it[typeKey] === "string") rec.type = it[typeKey];
  const sprintKey = Object.keys(it).find((k) => k === "sprint" || k.includes("принт"));
  if (sprintKey && it[sprintKey] && typeof it[sprintKey] === "object") rec.sprint = it[sprintKey].title;

  if (rec.number != null) byNumber.set(rec.number, rec);
}

/* --- все issues репо: state + parent (для дерева семей) --- */
const issues = new Map(); // number -> {state, parent}
let cursor = null;
for (;;) {
  const after = cursor ? `, after: "${cursor}"` : "";
  const d = gql(`query { repository(owner: "${OWNER}", name: "${REPO}") { issues(first: 100${after}, orderBy: { field: CREATED_AT, direction: ASC }) { pageInfo { hasNextPage endCursor } nodes { number state title parent { number } } } } }`);
  const conn = d.repository.issues;
  for (const n of conn.nodes) issues.set(n.number, { state: n.state, parent: n.parent ? n.parent.number : null, title: n.title });
  if (!conn.pageInfo.hasNextPage) break;
  cursor = conn.pageInfo.endCursor;
}
const childrenOf = new Map(); // parentNumber -> [childNumbers]
for (const [num, info] of issues) {
  if (info.parent != null) {
    if (!childrenOf.has(info.parent)) childrenOf.set(info.parent, []);
    childrenOf.get(info.parent).push(num);
  }
}
const isDone = (num) => {
  const iss = issues.get(num);
  if (!iss) return false;
  if (iss.state === "CLOSED") return true;
  const rec = byNumber.get(num);
  return rec ? rec.status === "Done" : false;
};

/* --- текущая итерация --- */
const dSprint = gql(`query { user(login: "${OWNER}") { projectV2(number: ${PROJECT}) { field(name: "Sprint") { ... on ProjectV2IterationField { configuration { iterations { id title startDate duration } } } } } } }`);
const today = new Date().toISOString().slice(0, 10);
const iters = dSprint.user.projectV2.field.configuration.iterations;
const current = iters.find((i) => i.startDate <= today && today < new Date(new Date(i.startDate).getTime() + i.duration * 86400000).toISOString().slice(0, 10)) || iters.filter((i) => i.startDate <= today).slice(-1)[0];
const currentTitle = current ? current.title : null;

/* --- проверки --- */
const blockers = [];
const warnings = [];
const B = (num, msg) => blockers.push(`#${num} ${msg}`);
const W = (num, msg) => warnings.push(`#${num} ${msg}`);

for (const rec of byNumber.values()) {
  const num = rec.number;
  const title = rec.title || "";

  // 1. обязательные поля
  if (!rec.status) B(num, "нет Статуса на доске");
  if (!rec.type) B(num, "нет Типа на доске");

  // 2. код заголовка vs Тип
  const m = title.match(/^\[([A-Z]+)-([IESTB])(\d+)\]/);
  if (m && rec.type && TYPE_BY_CODE[m[2]] !== rec.type) {
    W(num, `код [${m[1]}-${m[2]}${m[3]}] = ${TYPE_BY_CODE[m[2]]}, поле Тип = ${rec.type}`);
  }

  // 3. направление у семейных тикетов
  if (m && !NO_DIR_OK.test(title) && !rec.dir) {
    W(num, "нет Направления");
  }

  // 4. спринт у пайплайна
  const inPipe = rec.status && PIPELINE.includes(rec.status);
  if (inPipe && (!rec.sprint || rec.sprint !== currentTitle)) {
    B(num, `статус ${rec.status}, а спринт ${rec.sprint ? `«${rec.sprint}» (не текущий)` : "не проставлен"} — нужен «${currentTitle}»`);
  }
  if (rec.status === "Todo" && (!rec.sprint || rec.sprint !== currentTitle)) {
    // уже покрыто выше; Todo дополнительно ничего
  }

  // 5. In Design только для need_design
  if (rec.status === "In Design" && !(rec.labels || []).some((l) => (typeof l === "string" ? l : l.name) === "need_design")) {
    W(num, "статус In Design без метки need_design");
  }

  // 6. приоритет у оформленных тикетов
  if (["Backlog", ...PIPELINE].includes(rec.status) && rec.prio == null) {
    W(num, "нет Приоритета");
  }

  // 7. SP у недоделанных эпиков
  if (rec.type === "Epic" && rec.status !== "Done" && rec.sp == null) {
    W(num, "эпик без Story Points");
  }

  // 8. борд ↔ issue
  const iss = issues.get(num);
  if (iss) {
    if (rec.status === "Done" && iss.state === "OPEN") B(num, "борд Done, issue открыт — закрыть issue");
    if (rec.status !== "Done" && iss.state === "CLOSED") B(num, `issue закрыт, борд ${rec.status || "-"} — поставить Done`);
  } else {
    W(num, "issue не найден в репо");
  }

  // 9. семьи: родитель Done при живых детях / все дети Done, родитель не Done
  const kids = childrenOf.get(num) || [];
  if (kids.length) {
    const allKidsDone = kids.every((k) => isDone(k));
    if (rec.status === "Done" && !allKidsDone) {
      const open = kids.filter((k) => !isDone(k));
      B(num, `статус Done, но дети не Done: ${open.map((x) => "#" + x).join(", ")}`);
    }
    if (!allKidsDone && rec.status === "Done") { /* покрыто выше */ }
    if (allKidsDone && rec.status && rec.status !== "Done" && ["Idea", "Epic", "Story"].includes(rec.type || "")) {
      B(num, `все дети Done, родитель в статусе ${rec.status} — закрыть (Done)`);
    }
    // 10. спринт семьи: ребёнок в пайплайне с текущим спринтом → предки с текущим спринтом
    for (const k of kids) {
      const krec = byNumber.get(k);
      const kss = issues.get(k);
      const kInPipe = krec ? krec.status && PIPELINE.includes(krec.status) : false;
      if (kInPipe && krec.sprint === currentTitle) {
        // подняться по цепочке родителей
        let p = kss ? kss.parent : null;
        while (p != null) {
          const prec = byNumber.get(p);
          if (!prec) B(num, `предок семьи #${p} отсутствует на доске`);
          else if (prec.sprint !== currentTitle) B(num, `ребёнок в работе («${currentTitle}»), а предок #${p} ${prec.sprint ? `со спринтом «${prec.sprint}»` : "без спринта"}`);
          p = issues.get(p) ? issues.get(p).parent : null;
        }
      }
    }
  }
}

/* --- отчёт --- */
console.log(`Доска: ${items.length} items, issues: ${issues.size}, текущий спринт: ${currentTitle || "-"}`);
if (blockers.length) {
  console.log(`\nBLOCKERS (${blockers.length}):`);
  for (const b of blockers) console.log("  [B] " + b);
}
if (warnings.length) {
  console.log(`\nWARNINGS (${warnings.length}):`);
  for (const w of warnings) console.log("  [W] " + w);
}
if (!blockers.length && !warnings.length) console.log("Нарушений нет — доска в порядке.");
process.exit(blockers.length ? 1 : 0);
