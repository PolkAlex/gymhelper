const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'web', 'app.js'), 'utf8');
const cat = fs.readFileSync(path.join(root, 'web', 'catalog.js'), 'utf8');
const fails = [];

if (/\.startedAt|\.endedAt/.test(app)) {
    fails.push('app.js использует startedAt/endedAt — должно быть started/ended (ключи сервера)');
}

const actBlock = app.match(/const ACTIONS = \{([\s\S]*?)\n\};/);
if (!actBlock) {
    fails.push('Блок ACTIONS не найден');
} else {
    const keys = new Set();
    for (const m of actBlock[1].matchAll(/([a-zA-Z]+):\s*(?:async\s+)?function/g)) keys.add(m[1]);
    const used = new Set();
    for (const m of app.matchAll(/data-act="([a-zA-Z]+)"/g)) used.add(m[1]);
    for (const m of app.matchAll(/data-b="([a-zA-Z]+)"/g)) used.add(m[1]);
    for (const m of app.matchAll(/confirmModal\([^,]+,\s*'([a-zA-Z]+)'/g)) used.add(m[1]);
    for (const u of used) {
        if (!keys.has(u)) fails.push('data-act/data-b без обработчика в ACTIONS: ' + u);
    }
    for (const k of keys) {
        if (k === 'modalBackdrop') continue;
        /* nutrModal/autoTitle/deleteSet: кнопки временно скрыты из UI, код оставлен — вернём позже.
           tplSaveModal [UX-T18]: иконка «💾 В шаблоны» из шапки завершённой убрана,
           ACTION и модалка сохранения остались (фича живёт в боте) */
        if (k === 'nutrModal' || k === 'autoTitle' || k === 'deleteSet' || k === 'tplSaveModal') continue;
        if (!app.includes('data-act="' + k + '"') && !app.includes('data-b="' + k + '"') && !app.includes("'" + k + "'")) {
            fails.push('обработчик ACTIONS никогда не используется: ' + k);
        }
    }
}

const ctx = {};
try {
    const fn = new Function(cat + '\nreturn {CATALOG: CATALOG, CATS: CATS, CAT_SECTIONS: CAT_SECTIONS, ICONS: ICONS};');
    Object.assign(ctx, fn());
} catch (e) {
    fails.push('catalog.js не выполняется: ' + e.message);
}
if (ctx.CATALOG) {
    const validTags = new Set();
    for (const sec of Object.values(ctx.CATS)) for (const c of sec) validTags.add(c.id);
    const ids = new Set();
    for (const ex of ctx.CATALOG) {
        if (!ex.id) fails.push('упражнение без id: ' + ex.n);
        if (ids.has(ex.id)) fails.push('дубликат id в каталоге: ' + ex.id);
        ids.add(ex.id);
        for (const k of ['n', 'i', 't', 'met', 'how']) {
            if (ex[k] === undefined) fails.push('каталог ' + (ex.id || '?') + ': нет поля ' + k);
        }
        for (const t of (ex.t || [])) {
            if (!validTags.has(t)) fails.push('каталог: ' + ex.n + ' — неизвестный тег ' + t);
        }
        if (!ctx.ICONS[ex.i]) fails.push('каталог: ' + ex.n + ' — нет иконки ' + ex.i);
    }
}

if (fails.length) {
    console.error('ПРОВАЛ (' + fails.length + '):\n - ' + fails.join('\n - '));
    process.exit(1);
}
console.log('CHECK OK');
