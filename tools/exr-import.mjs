#!/usr/bin/env node
'use strict';
/* ==========================================================================
   [EXR-T2] Импорт базы упражнений free-exercise-db (yuhonas, Unlicense)
   в каталог GymHelper.

   Источник отбора: tools/exr-select.json
     map — привязка СУЩЕСТВУЮЩИХ упражнений web/catalog.js к датасету
           (+ RU-описание desc);
     new — НОВЫЕ упражнения каталога (полный формат записи {id,n,i,t,met,how,err,desc}).

   Что делает скрипт:
     1. Скачивает dist/exercises.json (кэш: tools/.fdb-cache/exercises.json);
     2. Проверяет, что все id из select.json существуют в датасете;
     3. Патчит web/catalog.js:
        - существующим записям добавляет img/desc/src:'fdb' (идемпотентно:
          старые сгенерированные поля заменяются);
        - новые записи дописывает в конец CATALOG (если id ещё нет);
     4. Бампит ?v= у catalog.js в web/index.html;
     5. Скачивает фото в web/img/exercises/<catalogId>-0.jpg и -1.jpg
        (2 ракурса; существующие файлы не перекачиваются).

   Повторный запуск безопасен (идемпотентен). Проверка: node tools/exr-import.mjs --dry
   (показывает план без записи файлов).

   Размер статики: оригиналы ~70KB/фото; при превышении бюджета 12MB уменьшить
   до 600px по длинной стороне можно локально (Windows) — см. отчёт задачи
   [EXR-T2] (PowerShell System.Drawing); web/img/exercises после этого
   остаётся в репо в сжатом виде.
   ========================================================================== */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELECT = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'exr-select.json'), 'utf8'));
const CATALOG_JS = path.join(root, 'web', 'catalog.js');
const INDEX_HTML = path.join(root, 'web', 'index.html');
const CACHE_DIR = path.join(root, 'tools', '.fdb-cache');
const DATASET_CACHE = path.join(CACHE_DIR, 'exercises.json');
const IMG_DIR = path.join(root, SELECT.imagesDir);

const DRY = process.argv.includes('--dry');
const log = (m) => console.log(m);

async function fetchText(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' для ' + url);
    return res.text();
}

async function fetchDataset() {
    if (fs.existsSync(DATASET_CACHE)) {
        const stat = fs.statSync(DATASET_CACHE);
        const ageDays = (Date.now() - stat.mtimeMs) / 86400000;
        if (ageDays < 30) return fs.readFileSync(DATASET_CACHE, 'utf8');
    }
    log('Скачиваю датасет ' + SELECT.source.datasetUrl);
    const text = await fetchText(SELECT.source.datasetUrl);
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(DATASET_CACHE, text);
    return text;
}

/* ---------- патч web/catalog.js ---------- */

/* регион записи каталога: от "id: '<x>'" до следующего "{ id:" (или конца массива).
   Ищем ТОЛЬКО внутри массива CATALOG — в CATS (чипы категорий) есть свои id
   ('fly', 'squat', 'pullup'...), которые не должны совпасть раньше записи */
function catalogBounds(content) {
    const catStart = content.indexOf('const CATALOG = [');
    const catEnd = content.indexOf('function findCatalog');
    if (catStart < 0 || catEnd < 0 || catEnd <= catStart) throw new Error('не найден массив CATALOG в catalog.js');
    return { catStart, catEnd };
}

function entryRegion(content, catalogId) {
    const { catStart, catEnd } = catalogBounds(content);
    const start = content.indexOf("id: '" + catalogId + "'", catStart);
    if (start < 0 || start > catEnd) return null;
    let end = content.indexOf('{ id:', start);
    if (end < 0 || end > catEnd) end = content.indexOf('\n];', start);
    return { start, end, text: content.slice(start, end) };
}

function escJs(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/* доминирующий EOL файла: вставки должны совпадать с остальным файлом,
   иначе смешанные концы строк ломают нормализацию git (autocrlf) */
function detectEol(content) {
    return content.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
}

function patchExisting(content, catalogId, fdbEntry, desc) {
    const region = entryRegion(content, catalogId);
    if (!region) throw new Error('в catalog.js не найдено упражнение с id: ' + catalogId);
    const eol = detectEol(content);
    let text = region.text
        /* идемпотентность: снять ранее вставленные генерированные поля */
        .replace(/ img: '[^']*', src: 'fdb',/, '')
        .replace(new RegExp(eol + '      desc: \'[^\']*\','), '');
    /* вставка img/src сразу после "met: N," и desc отдельной строкой перед how */
    const metIdx = text.indexOf('met:');
    if (metIdx < 0) throw new Error('в записи ' + catalogId + ' нет поля met');
    const commaIdx = text.indexOf(',', metIdx);
    if (commaIdx < 0) throw new Error('в записи ' + catalogId + ' некорректный met');
    const inject = " img: '" + catalogId + "', src: 'fdb'," + eol + "      desc: '" + escJs(desc) + "',";
    text = text.slice(0, commaIdx + 1) + inject + text.slice(commaIdx + 1);
    return content.slice(0, region.start) + text + content.slice(region.end);
}

function newEntryText(ex, eol) {
    const tags = ex.t.map(t => "'" + t + "'").join(', ');
    let line1 = "    { id: '" + ex.id + "', n: '" + escJs(ex.n) + "', i: '" + ex.i + "', t: [" + tags + "], met: " + ex.met.toFixed(1) + ", img: '" + ex.id + "', src: 'fdb',";
    return line1 +
        eol + "      desc: '" + escJs(ex.desc) + "'," +
        eol + "      how: [" + ex.how.map(s => "'" + escJs(s) + "'").join(', ') + ']' +
        (ex.err && ex.err.length ? ", err: [" + ex.err.map(s => "'" + escJs(s) + "'").join(', ') + ']' : '') +
        ' }';
}

function patchCatalog(content, select) {
    const eol = detectEol(content);
    /* 1. существующие записи */
    for (const [catalogId, m] of Object.entries(select.map)) {
        content = patchExisting(content, catalogId, null, m.desc);
    }
    /* 2. новые записи: дописать перед "];" закрытием CATALOG, пропуская уже добавленные */
    const { catEnd } = catalogBounds(content);
    const tailIdx = content.lastIndexOf('\n];', catEnd);
    if (tailIdx < 0) throw new Error('не найден конец массива CATALOG в catalog.js');
    const fresh = select.new.filter(ex => !entryRegion(content, ex.id));
    const skipped = select.new.length - fresh.length;
    if (fresh.length) {
        /* запятая должна встать сразу после "}", то есть ПЕРЕД "\r" у CRLF-файлов:
           "\n];" — позиция \n, у CRLF перед ней \r, поэтому отступаем назад */
        let ins = tailIdx;
        if (ins > 0 && content[ins - 1] === '\r') ins--;
        const block = ',' + eol + fresh.map(ex => newEntryText(ex, eol)).join(',' + eol);
        content = content.slice(0, ins) + block + content.slice(ins);
    }
    return { content, added: fresh.length, skipped };
}

function bumpVersion(html) {
    const m = html.match(/catalog\.js\?v=(\d+)/);
    if (!m) throw new Error('в index.html не найден catalog.js?v=');
    return { html: html.replace('catalog.js?v=' + m[1], 'catalog.js?v=' + (Number(m[1]) + 1)), from: m[1], to: Number(m[1]) + 1 };
}

/* ---------- фото ---------- */

async function downloadPhoto(url, dest) {
    if (fs.existsSync(dest)) return 'skip';
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' для ' + url);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    return buf.length;
}

async function downloadPhotos(dataset, select) {
    fs.mkdirSync(IMG_DIR, { recursive: true });
    const jobs = [];
    for (const [catalogId, m] of Object.entries(select.map)) {
        jobs.push({ catalogId, fdb: m.fdb });
    }
    for (const ex of select.new) jobs.push({ catalogId: ex.id, fdb: ex.fdb });
    let downloaded = 0, skipped = 0, bytes = 0;
    for (const j of jobs) {
        const dsEntry = dataset.find(e => e.id === j.fdb);
        if (!dsEntry) throw new Error('в датасете нет упражнения: ' + j.fdb);
        const imgs = dsEntry.images || [];
        for (let a = 0; a < 2; a++) {
            const rel = imgs[a];
            if (!rel) { log('  ! нет ракурса ' + a + ' у ' + j.fdb); continue; }
            const url = SELECT.source.imagesBase + '/' + rel;
            const dest = path.join(IMG_DIR, j.catalogId + '-' + a + '.jpg');
            const r = await downloadPhoto(url, dest);
            if (r === 'skip') skipped++;
            else { downloaded++; bytes += r; }
        }
    }
    return { downloaded, skipped, bytesMb: (bytes / 1048576).toFixed(2) };
}

/* ---------- main ---------- */

const dataset = JSON.parse(await fetchDataset());
log('Датасет: ' + dataset.length + ' упражнений');

/* валидация select против датасета */
for (const [catalogId, m] of Object.entries(SELECT.map)) {
    if (!dataset.find(e => e.id === m.fdb)) throw new Error('map[' + catalogId + ']: в датасете нет ' + m.fdb);
}
for (const ex of SELECT.new) {
    if (!dataset.find(e => e.id === ex.fdb)) throw new Error('new[' + ex.id + ']: в датасете нет ' + ex.fdb);
}
log('Отбор валиден: ' + Object.keys(SELECT.map).length + ' маппингов + ' + SELECT.new.length + ' новых = ' +
    (Object.keys(SELECT.map).length + SELECT.new.length) + ' упражнений из базы');

const catContent = fs.readFileSync(CATALOG_JS, 'utf8');
const { content, added, skipped } = patchCatalog(catContent, SELECT);
const catalogChanged = content !== catContent;
if (DRY) {
    log('DRY: каталог ' + (catContent.length / 1024).toFixed(0) + 'KB → ' + (content.length / 1024).toFixed(0) + 'KB, новых записей: ' + added + ', пропущено (уже есть): ' + skipped);
} else {
    fs.writeFileSync(CATALOG_JS, content, 'utf8');
    if (catalogChanged) {
        const bump = bumpVersion(fs.readFileSync(INDEX_HTML, 'utf8'));
        fs.writeFileSync(INDEX_HTML, bump.html, 'utf8');
        log('catalog.js пропатчен: добавлено записей ' + added + ', пропущено (уже есть) ' + skipped + '; index.html catalog.js v' + bump.from + '→v' + bump.to);
    } else {
        log('catalog.js уже в актуальном состоянии (добавлено 0, пропущено ' + skipped + ') — ?v= не менялся');
    }
    log('Скачиваю фото (' + (Object.keys(SELECT.map).length + SELECT.new.length) + '×2 ракурса)...');
    const ph = await downloadPhotos(dataset, SELECT);
    log('Фото: скачано ' + ph.downloaded + ', уже были ' + ph.skipped + ', новых байт ' + ph.bytesMb + 'MB');
    const files = fs.readdirSync(IMG_DIR).filter(f => f.endsWith('.jpg'));
    const total = files.reduce((s, f) => s + fs.statSync(path.join(IMG_DIR, f)).size, 0);
    log('Итого в ' + SELECT.imagesDir + ': ' + files.length + ' файлов, ' + (total / 1048576).toFixed(2) + 'MB');
}
