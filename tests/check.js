const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'web', 'app.js'), 'utf8');
const cat = fs.readFileSync(path.join(root, 'web', 'catalog.js'), 'utf8');
/* [FIT-S2] bodymap.js — модуль карты мышц: свой разметочный data-act="mapZone" (bodySvg),
   participates в проверке пары «data-act ↔ ACTIONS» наравне с app.js */
const bodymap = fs.readFileSync(path.join(root, 'web', 'bodymap.js'), 'utf8');
const appUi = app + bodymap;
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
    for (const m of appUi.matchAll(/data-act="([a-zA-Z]+)"/g)) used.add(m[1]);
    for (const m of appUi.matchAll(/data-b="([a-zA-Z]+)"/g)) used.add(m[1]);
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
        if (!appUi.includes('data-act="' + k + '"') && !app.includes('data-b="' + k + '"') && !app.includes("'" + k + "'")) {
            fails.push('обработчик ACTIONS никогда не используется: ' + k);
        }
    }
}

const ctx = {};
try {
    const fn = new Function(cat + '\nreturn {CATALOG: CATALOG, CATS: CATS, CAT_SECTIONS: CAT_SECTIONS, ICONS: ICONS, FILTERS: FILTERS};');
    Object.assign(ctx, fn());
} catch (e) {
    fails.push('catalog.js не выполняется: ' + e.message);
}
/* [EXR-T4] FILTERS — словарь фильтров «Техники»: проверяем структуру (лейблы, подгруппы,
   уникальные id). Контент тегов записей каталога (t/tags) валидирует владелец контента [EXR-T3] */
if (ctx.FILTERS) {
    const F = ctx.FILTERS;
    if (!F.muscle || !Array.isArray(F.muscle.items) || F.muscle.items.length !== 8) {
        fails.push('FILTERS.muscle: ожидалось 8 групп мышц');
    }
    /* [EXR-T4 fix] 5 подгрупп: «Брусья и турник» вынесена из «Тренажёров» в конец (ревью PR #212) */
    if (!F.gear || !Array.isArray(F.gear.groups) || F.gear.groups.length !== 5) {
        fails.push('FILTERS.gear: ожидалось 5 подгрупп инвентаря');
    } else if (F.gear.groups[F.gear.groups.length - 1].n !== 'Брусья и турник') {
        fails.push('FILTERS.gear: подгруппа «Брусья и турник» должна быть последней');
    }
    if (!Array.isArray(F.cats) || F.cats.length !== 4) {
        fails.push('FILTERS.cats: ожидалось 4 одиночные категории');
    }
    const fids = new Set();
    const fitems = [];
    if (F.muscle) fitems.push(...(F.muscle.items || []));
    if (F.gear) for (const g of (F.gear.groups || [])) fitems.push(...(g.items || []));
    if (Array.isArray(F.cats)) fitems.push(...F.cats);
    for (const it of fitems) {
        if (!it.id || !it.n) fails.push('FILTERS: айтем без id или n: ' + JSON.stringify(it));
        if (fids.has(it.id)) fails.push('дубликат id в FILTERS: ' + it.id);
        fids.add(it.id);
    }
}
/* [EXR-T4 fix] CATS пикера — под схему m:/e:/cat:: секция «Вид» удалена, у айтемов
   (кроме «Своих») есть tags с префиксными тегами, id уникальны */
if (ctx.CATS) {
    if (ctx.CATS.type) fails.push('CATS.type: секция «Вид» должна быть удалена');
    if (!ctx.CATS.muscle || ctx.CATS.muscle.length !== 7) fails.push('CATS.muscle: ожидалось 7 категорий');
    if (!ctx.CATS.gear || ctx.CATS.gear.length !== 17) fails.push('CATS.gear: ожидалось 17 категорий инвентаря');
    const cids = new Set();
    for (const sec of ['muscle', 'gear', 'coll']) {
        for (const it of (ctx.CATS[sec] || [])) {
            if (!it.id || !it.n) fails.push('CATS.' + sec + ': айтем без id или n');
            if (cids.has(it.id)) fails.push('дубликат id в CATS: ' + it.id);
            cids.add(it.id);
            if (it.id !== 'own' && (!Array.isArray(it.tags) || !it.tags.some(t => /^(m|e|cat):/.test(t)))) {
                fails.push('CATS.' + sec + ': ' + it.id + ' — нет префиксных тегов tags');
            }
            if (it.icon && !ctx.ICONS[it.icon]) fails.push('CATS.' + sec + ': ' + it.id + ' — нет иконки ' + it.icon);
        }
    }
}
if (ctx.CATALOG) {
    /* [EXR-T3] контракт тегов: строки с префиксами m:/e:/cat: из закрытых словарей.
       Ключи синхронизированы с FILTERS в шапке catalog.js ([EXR-T4]); структурную
       часть (id/n/i/met/how, фото) валидируем здесь же — единый проход по каталогу */
    const MUSCLES = new Set(['m:chest', 'm:back', 'm:shoulders', 'm:legs', 'm:core', 'm:glutes', 'm:biceps', 'm:triceps']);
    const EQUIP = new Set(['e:barbell', 'e:dumbbell', 'e:kettlebell', 'e:ezbar', 'e:plate', 'e:smith', 'e:cable',
        'e:leverage', 'e:gravitron', 'e:bench', 'e:dipbar', 'e:pullupbar', 'e:machine', 'e:resband', 'e:trx',
        'e:fitball', 'e:medball', 'e:abwheel', 'e:none']);
    const CATS2 = new Set(['cat:cardio', 'cat:stretch', 'cat:warmup', 'cat:cooldown', 'cat:stretching']);
    const ids = new Set();
    const imgDir = path.join(root, 'web', 'img', 'exercises');
    for (const ex of ctx.CATALOG) {
        if (!ex.id) fails.push('упражнение без id: ' + ex.n);
        if (ids.has(ex.id)) fails.push('дубликат id в каталоге: ' + ex.id);
        ids.add(ex.id);
        /* [EXR-T3] контент на tags-схеме: tags обязателен, legacy t запрещён
           (структурная часть EXR-T4: поля n/i/met/how + фото-файлы — проверяются ниже) */
        for (const k of ['n', 'i', 'tags', 'met', 'how']) {
            if (ex[k] === undefined) fails.push('каталог ' + (ex.id || '?') + ': нет поля ' + k);
        }
        if (ex.t !== undefined) fails.push('каталог ' + (ex.id || '?') + ': устаревшее поле t (должно быть tags)');
        const tags = ex.tags || [];
        if (!tags.length) fails.push('каталог ' + (ex.id || '?') + ': пустой tags');
        for (const t of tags) {
            if (!MUSCLES.has(t) && !EQUIP.has(t) && !CATS2.has(t)) {
                fails.push('каталог: ' + ex.n + ' — неизвестный тег ' + t);
            }
        }
        /* силовые без cat:* обязаны иметь мышцу; кардио-категории мышц не требуют */
        const hasCat = tags.some(t => CATS2.has(t));
        const hasMuscle = tags.some(t => MUSCLES.has(t));
        if (!hasCat && !hasMuscle) fails.push('каталог: ' + ex.n + ' — нет ни m:*, ни cat:*');
        /* e:none не сочетается с другим инвентарём */
        const eqTags = tags.filter(t => t.startsWith('e:'));
        if (eqTags.includes('e:none') && eqTags.length > 1) fails.push('каталог: ' + ex.n + ' — e:none вместе с другим e:*');
        if (tags.filter(t => tags.indexOf(t) !== tags.lastIndexOf(t)).length) {
            fails.push('каталог: ' + ex.n + ' — дубликат тега внутри записи');
        }
        if (!ctx.ICONS[ex.i]) fails.push('каталог: ' + ex.n + ' — нет иконки ' + ex.i);
        /* фото: оба ракурса должны существовать (Техника рендерит -0 и -1) */
        if (ex.img) {
            /* [EXR-T6] при наличии фото нужно и текстовое описание (ловим рассинхрон данные↔файлы) */
            if (!ex.desc || !String(ex.desc).trim()) fails.push('каталог: ' + ex.n + ' — есть img, нет desc');
            for (const a of [0, 1]) {
                const f = path.join(imgDir, ex.img + '-' + a + '.jpg');
                if (!fs.existsSync(f)) fails.push('каталог: ' + ex.n + ' — нет фото ' + ex.img + '-' + a + '.jpg');
            }
        }
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

/* [EXR-T4 fix] юниты mgTagKey: алиасы bi/трицепса → «Руки» (arms) — без них подходы
   на руки молча пропадают из «Мышечных групп · эта неделя» при новой схеме тегов */
try {
    const mg = new Function(grabFn(app, 'mgTagKey') + '\nreturn mgTagKey;')();
    for (const [tag, key] of [['m:biceps', 'arms'], ['m:triceps', 'arms'], ['m:chest', 'chest'],
        ['m:back', 'back'], ['m:shoulders', 'shoulders'], ['m:legs', 'legs'], ['m:core', 'core'],
        ['m:glutes', 'glutes'], ['arms', 'arms'], ['chest', 'chest']]) {
        if (mg(tag) !== key) fails.push('mgTagKey(' + tag + ') = ' + mg(tag) + ', ожидалось ' + key);
    }
    /* каждая группа фильтра мышц обязана давать существующий ключ MG_STYLE */
    const mgBlock = app.match(/const MG_STYLE = \{([\s\S]*?)\};/);
    if (!mgBlock) {
        fails.push('app.js: не найден MG_STYLE');
    } else {
        const styleKeys = new Set(Array.from(mgBlock[1].matchAll(/([a-z]+)\s*:/g)).map(function (m) { return m[1]; }));
        const F = ctx.FILTERS;
        for (const it of ((F && F.muscle && F.muscle.items) || [])) {
            if (!styleKeys.has(mg(it.id))) fails.push('FILTERS.muscle: ' + it.id + ' → ключ "' + mg(it.id) + '" отсутствует в MG_STYLE');
        }
    }
} catch (e) {
    fails.push('юниты mgTagKey не выполняются: ' + e.message);
}

if (fails.length) {
    console.error('ПРОВАЛ (' + fails.length + '):\n - ' + fails.join('\n - '));
    process.exit(1);
}
console.log('CHECK OK');
