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

/* [UX-T29] юниты чистых функций даты рождения: извлекаются из app.js без DOM/Telegram.
   Возраст наступает 1-го числа месяца рождения; без валидной пары — статический age */
function grabFn(src, name) {
    const start = src.indexOf('function ' + name + '(');
    if (start < 0) { fails.push('app.js: нет функции ' + name); return ''; }
    const end = src.indexOf('\n}', start);
    if (end < 0) { fails.push('app.js: не найден конец функции ' + name); return ''; }
    return src.slice(start, end + 2);
}
try {
    const birthApi = new Function(
        grabFn(app, 'ageOf') + '\n' + grabFn(app, 'ageWord') + '\n' + grabFn(app, 'isBirthMonth') +
        '\nreturn { ageOf: ageOf, ageWord: ageWord, isBirthMonth: isBirthMonth };')();
    const AW = birthApi.ageWord;
    for (const [n, w] of [[1, 'год'], [2, 'года'], [4, 'года'], [5, 'лет'], [11, 'лет'],
        [21, 'год'], [22, 'года'], [24, 'года'], [31, 'год'], [100, 'лет']]) {
        if (AW(n) !== w) fails.push('ageWord(' + n + ') = ' + AW(n) + ', ожидалось ' + w);
    }
    const AO = birthApi.ageOf;
    const p1990 = { birthYear: 1990, birthMonth: 11 };
    if (AO(p1990, new Date(2026, 10, 9)) !== 36) fails.push('ageOf: 1990-11 в ноябре 2026 → ' + AO(p1990, new Date(2026, 10, 9)) + ', ожидалось 36');
    if (AO(p1990, new Date(2026, 9, 31)) !== 35) fails.push('ageOf: до 1-го числа месяца рождения — 35');
    if (AO(p1990, new Date(2026, 10, 1)) !== 36) fails.push('ageOf: возраст наступает 1-го числа месяца рождения');
    if (AO(p1990, new Date(2026, 11, 31)) !== 36) fails.push('ageOf: после месяца рождения в том же году — 36');
    if (AO(p1990, new Date(2027, 0, 5)) !== 36) fails.push('ageOf: январь следующего года — ещё 36');
    if (AO(p1990, new Date(2027, 10, 1)) !== 37) fails.push('ageOf: ноябрь следующего года — 37');
    /* граница минимума [I8-update 09.11]: год текущий−5 в текущем месяце → ровно 5 лет */
    const real = new Date();
    const pMin = { birthYear: real.getFullYear() - 5, birthMonth: real.getMonth() + 1 };
    if (AO(pMin, real) !== 5) fails.push('ageOf: год текущий−5 в текущем месяце → ' + AO(pMin, real) + ', ожидалось 5');
    /* legacy age-only и мусорная дата → статический age; null → 0 */
    if (AO({ age: 31 }, new Date(2026, 10, 9)) !== 31) fails.push('ageOf: legacy age-only → 31');
    if (AO({ age: 30, birthYear: 1800, birthMonth: 13 }, new Date(2026, 10, 9)) !== 30) fails.push('ageOf: мусорная дата → статический age');
    if (AO(null, new Date(2026, 10, 9)) !== 0) fails.push('ageOf: null → 0');
    const IBM = birthApi.isBirthMonth;
    if (!IBM(p1990, new Date(2026, 10, 9))) fails.push('isBirthMonth: ноябрь при birthMonth=11 → true');
    if (IBM(p1990, new Date(2026, 11, 9))) fails.push('isBirthMonth: декабрь при birthMonth=11 → false');
    if (IBM({ age: 30 }, new Date(2026, 10, 9))) fails.push('isBirthMonth: без даты → false');
    if (IBM(null, new Date(2026, 10, 9))) fails.push('isBirthMonth: null → false');
} catch (e) {
    fails.push('юниты даты рождения не выполняются: ' + e.message);
}

if (fails.length) {
    console.error('ПРОВАЛ (' + fails.length + '):\n - ' + fails.join('\n - '));
    process.exit(1);
}
console.log('CHECK OK');
