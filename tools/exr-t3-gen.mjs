#!/usr/bin/env node
'use strict';
/* ==========================================================================
   [EXR-T3] (Issue #209, Story #207, Epic #206) Замена силовой базы.
   Генератор: миграция t:[...] -> tags:[...], удаление 5 записей, добавление
   новых (Смит + списки владельца). Данные — в exr-t3-data*.mjs.
   Один прогон (разовая миграция). Шапка catalog.js (ICONS/CATS) не трогается.
   ========================================================================== */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MIGRATE, DELETE, ADD_IMG } from './exr-t3-data.mjs';
import { NEW_A } from './exr-t3-data-a.mjs';
import { NEW_B } from './exr-t3-data-b.mjs';
import { NEW_C } from './exr-t3-data-c.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(root, 'web', 'catalog.js');
const content0 = fs.readFileSync(FILE, 'utf8');
if (content0.includes("id: 'smithsquat'") || /\bt: \[/.test(content0.slice(content0.indexOf('const CATALOG')))) {
    throw new Error('миграция [EXR-T3] уже применена — повторный запуск запрещён (разовая операция)');
}
const eol = content0.indexOf('\r\n') >= 0 ? '\r\n' : '\n';

const catStart = content0.indexOf('const CATALOG = [');
const catEnd = content0.indexOf('function findCatalog');
if (catStart < 0 || catEnd < 0 || catEnd <= catStart) throw new Error('массив CATALOG не найден');

/* границы записи внутри CATALOG */
function regions(content) {
    const list = [];
    let idx = content.indexOf("    { id: '", catStart);
    while (idx >= 0 && idx < catEnd) {
        let end = content.indexOf(eol + '    { id:', idx);
        if (end < 0 || end > catEnd) end = content.indexOf('\n];', idx);
        if (end < 0) throw new Error('не найден конец массива CATALOG');
        const line = content.slice(idx, content.indexOf("'", idx + 10));
        const m = content.slice(idx, idx + 200).match(/\{ id: '([^']+)'/);
        list.push({ start: idx, end: end, id: m[1] });
        idx = content.indexOf("    { id: '", end);
    }
    return list;
}

let content = content0;
const stats = { migrated: 0, deleted: [], imgAdded: [] };

/* 1. миграция + удаление + img для существующих (обрабатываем с конца, чтобы индексы не плыли) */
const regs = regions(content).reverse();
for (const r of regs) {
    const text = content.slice(r.start, r.end);
    if (DELETE.includes(r.id)) {
        /* удалить запись вместе с предшествующим "\n" */
        let s = r.start;
        if (content[s - 1] === '\n') s--;
        if (content[s - 1] === '\r') s--;
        content = content.slice(0, s) + content.slice(r.end);
        stats.deleted.push(r.id);
        continue;
    }
    let t = text;
    if (MIGRATE[r.id]) {
        const tags = MIGRATE[r.id].map(x => "'" + x + "'").join(', ');
        t = t.replace(/ t: \[[^\]]*\]/, ' tags: [' + tags + ']');
        if (t === text) throw new Error('не найдены теги у ' + r.id);
        stats.migrated++;
    }
    const ai = ADD_IMG[r.id];
    if (ai) {
        /* img/src после met + desc отдельной строкой перед how */
        const metM = t.match(/met: \d+\.\d,/);
        if (!metM) throw new Error('нет met у ' + r.id);
        t = t.replace(metM[0], metM[0] + " img: '" + r.id + "', src: 'fdb',");
        const howIdx = t.indexOf(eol + '      how:');
        if (howIdx < 0) throw new Error('нет how у ' + r.id);
        t = t.slice(0, howIdx) + eol + "      desc: '" + ai.desc + "'," + t.slice(howIdx);
        stats.imgAdded.push(r.id);
    }
    if (t !== text) content = content.slice(0, r.start) + t + content.slice(r.end);
}

/* 2. новые записи */
const NEW = [...NEW_A, ...NEW_B, ...NEW_C];
const seen = new Set();
function esc(s) { return String(s); }
function entryText(e) {
    const tags = e.tags.map(x => "'" + x + "'").join(', ');
    const imgPart = (e.fdb || e.copy) ? ", img: '" + e.id + "', src: 'fdb'" : '';
    let line = "    { id: '" + e.id + "', n: '" + esc(e.n) + "', i: '" + e.i + "', tags: [" + tags + '], met: ' + e.met.toFixed(1) + imgPart + ',';
    let body = eol + "      desc: '" + esc(e.desc) + "'," +
        eol + '      how: [' + e.how.map(s => "'" + esc(s) + "'").join(', ') + ']';
    if (e.err && e.err.length) body += ", err: [" + e.err.map(s => "'" + esc(s) + "'").join(', ') + ']';
    return line + body + ' }';
}
for (const e of NEW) {
    if (seen.has(e.id)) throw new Error('дубль id среди новых: ' + e.id);
    seen.add(e.id);
}
/* конец массива ищем по ТЕКУЩЕМУ контенту (миграция сдвинула позиции) */
const curCatEnd = content.indexOf('function findCatalog', catStart);
const tailIdx = content.lastIndexOf('\n];', curCatEnd);
if (tailIdx < 0 || tailIdx < catStart) throw new Error('не найден конец CATALOG');
let ins = tailIdx;
if (ins > 0 && content[ins - 1] === '\r') ins--;
const block = ',' + eol + NEW.map(entryText).join(',' + eol);
content = content.slice(0, ins) + block + content.slice(ins);

fs.writeFileSync(FILE, content, 'utf8');
console.log('мигрировано: ' + stats.migrated);
console.log('удалено: ' + stats.deleted.join(', '));
console.log('img добавлен: ' + stats.imgAdded.join(', '));
console.log('новых записей: ' + NEW.length);
console.log('размер: ' + content0.length + ' -> ' + content.length);
/* контроль: скрипт выполняется в контексте модуля, без record-патчей по второму кругу */
