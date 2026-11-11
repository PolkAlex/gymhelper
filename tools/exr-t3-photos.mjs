#!/usr/bin/env node
'use strict';
/* ==========================================================================
   [EXR-T3] Фото для новых записей каталога.
   1. Для записей с fdb — скачать 2 ракурса из free-exercise-db (кэш exercises.json);
   2. Для записей с copy — скопировать фото существующей записи (Смит-версии
      и семейные варианты → фото обычного аналога);
   3. Существующие файлы не перекачиваются. Отчёт: скачано/пропущено/без пары.
   ========================================================================== */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ADD_IMG } from './exr-t3-data.mjs';
import { NEW_A } from './exr-t3-data-a.mjs';
import { NEW_B } from './exr-t3-data-b.mjs';
import { NEW_C } from './exr-t3-data-c.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMG_DIR = path.join(root, 'web', 'img', 'exercises');
const IMAGES_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises';
const dataset = JSON.parse(fs.readFileSync(path.join(root, 'tools', '.fdb-cache', 'exercises.json'), 'utf8'));
const byId = new Map(dataset.map(e => [e.id, e]));

const NEW = [...NEW_A, ...NEW_B, ...NEW_C];

async function download(url, dest) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' для ' + url);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    return buf.length;
}

let got = 0, skip = 0, bytes = 0, noImg = [];
for (const e of NEW) {
    if (e.copy) {
        for (let a = 0; a < 2; a++) {
            const srcF = path.join(IMG_DIR, e.copy + '-' + a + '.jpg');
            const dstF = path.join(IMG_DIR, e.id + '-' + a + '.jpg');
            if (fs.existsSync(dstF)) { skip++; continue; }
            if (!fs.existsSync(srcF)) { noImg.push(e.id + ' (нет фото у ' + e.copy + ')'); break; }
            fs.copyFileSync(srcF, dstF);
            got++; bytes += fs.statSync(dstF).size;
        }
    } else if (e.fdb) {
        const ds = byId.get(e.fdb);
        if (!ds) { noImg.push(e.id + ' (fdb не найден: ' + e.fdb + ')'); continue; }
        for (let a = 0; a < 2; a++) {
            const rel = (ds.images || [])[a];
            if (!rel) { noImg.push(e.id + ' (нет ракурса ' + a + ')'); continue; }
            const dstF = path.join(IMG_DIR, e.id + '-' + a + '.jpg');
            if (fs.existsSync(dstF)) { skip++; continue; }
            bytes += await download(IMAGES_BASE + '/' + rel, dstF);
            got++;
        }
    } else {
        noImg.push(e.id + ' (без пары в fdb)');
    }
}

/* существующие записи, которым добавлены фото */
for (const [id, ai] of Object.entries(ADD_IMG)) {
    const ds = byId.get(ai.fdb);
    if (!ds) { noImg.push(id + ' (fdb не найден: ' + ai.fdb + ')'); continue; }
    for (let a = 0; a < 2; a++) {
        const rel = (ds.images || [])[a];
        if (!rel) { noImg.push(id + ' (нет ракурса ' + a + ')'); continue; }
        const dstF = path.join(IMG_DIR, id + '-' + a + '.jpg');
        if (fs.existsSync(dstF)) { skip++; continue; }
        bytes += await download(IMAGES_BASE + '/' + rel, dstF);
        got++;
    }
}

console.log('скачано/скопировано файлов: ' + got + ', уже были: ' + skip + ', байт: ' + (bytes / 1048576).toFixed(2) + 'MB');
console.log('без картинок: ' + noImg.length);
for (const n of noImg) console.log('  - ' + n);
