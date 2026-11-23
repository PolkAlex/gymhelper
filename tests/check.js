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

/* [ONB-T9] юниты парсера Strong CSV (web/importstrong.js): выполняется вместе с catalog.js
   в одной области видимости — findCatalog доступен парсеру через замыкание, как в браузере */
try {
    const imp = fs.readFileSync(path.join(root, 'web', 'importstrong.js'), 'utf8');
    const gymApi = new Function(cat + '\n' + imp + '\nreturn { STRONG: STRONG, findCatalog: findCatalog };')();
    const S = gymApi.STRONG;
    if (typeof gymApi.findCatalog('Жим штанги лёжа') !== 'object') {
        fails.push('check: в каталоге нет «Жим штанги лёжа» — юниты ниже невалидны');
    }

    /* parseCsv: кавычки с запятыми/переводами строк, ""-экранирование, BOM, CRLF, ;-фолбэк */
    let rows = S.parseCsv('\uFEFFa,b\r\n"1,5","x""y""z"\r\n');
    if (rows.length !== 2 || rows[0][0] !== 'a' || rows[0][1] !== 'b' || rows[1][0] !== '1,5' || rows[1][1] !== 'x"y"z') {
        fails.push('parseCsv: кавычки/BOM/CRLF разобраны неверно: ' + JSON.stringify(rows));
    }
    rows = S.parseCsv('a;b\n1;2');
    if (rows[0][1] !== 'b' || rows[1][1] !== '2') fails.push('parseCsv: ;-разделитель не распознан');
    /* пустые строки сохраняются (нумерация skipped.line по исходному файлу) — их
       пропускает сам parseStrongCsv; хвостовой \n даёт пустую строку в конце */
    rows = S.parseCsv('a,b\n1,2\n\n');
    if (rows.length !== 3 || rows[2].length !== 1 || rows[2][0] !== '') {
        fails.push('parseCsv: пустые строки должны сохраняться для нумерации: ' + JSON.stringify(rows));
    }

    /* пустой / whitespace-only файл → Э8 «нет тренировок», не Э7 «не Strong» (§4.5) */
    const r0 = S.parseStrongCsv('', { unit: 'kg' });
    if (r0.status !== 'empty') fails.push('parseStrongCsv: пустой файл — ' + r0.status + ', ожидалось empty');
    const rWs = S.parseStrongCsv('\n  \n\n', { unit: 'kg' });
    if (rWs.status !== 'empty') fails.push('parseStrongCsv: whitespace-only файл — ' + rWs.status + ', ожидалось empty');

    /* 10 колонок Strong: Date, Workout Name, Duration, Exercise Name, Set Order, Weight, Reps, Distance, Time, Weight Unit */
    const HEAD = 'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Time,Weight Unit\n';
    const RU_BENCH = 'Жим штанги лёжа'; /* имя из каталога — не должно попасть в unknown */

    /* нумерация пропусков учитывает пустые строки файла (ревью [ONB-T9]): заголовок=1,
       бланк=2, Push-up=3 (ок), Plank=4 (пропуск «пустые повторения» → строка 4) */
    const resBlank = S.parseStrongCsv(HEAD +
        '\n' +
        '2024-11-18 07:00,Gym,,Push-up,1,,15,,,\n' +
        '2024-11-18 07:00,Gym,,Plank,2,30,0,,,\n', { unit: 'kg' });
    if (resBlank.status !== 'ok' || resBlank.skipped.length !== 1 || resBlank.skipped[0].line !== 4) {
        fails.push('parseStrongCsv: номер строки пропуска с бланк-строкой — ' + JSON.stringify(resBlank.skipped));
    }

    /* happy path: маппинг, сортировка по SET ORDER, схлопывание 60×8×3, title/duration */
    const csvOk = HEAD +
        '2024-11-18 07:00,Full Gym,1h 6m 25s,' + RU_BENCH + ',2,60,8,,,kg\n' +
        '2024-11-18 07:00,Full Gym,1h 6m 25s,' + RU_BENCH + ',1,60,8,,,kg\n' +
        '2024-11-18 07:00,Full Gym,1h 6m 25s,' + RU_BENCH + ',3,60,8,,,kg\n' +
        '2024-11-18 07:00,Full Gym,1h 6m 25s,Bench Press (Barbell),1,62.5,10,,,kg\n' +
        '2024-11-19 18:30:00,Full Gym,35,Lat Pulldown,1,50,12,,,kg\n';
    const res = S.parseStrongCsv(csvOk, { unit: 'kg' });
    if (res.status !== 'ok') {
        fails.push('parseStrongCsv happy path: status ' + res.status);
    } else {
        if (res.workouts.length !== 2) fails.push('parseStrongCsv: ожидалось 2 тренировки, пришло ' + res.workouts.length);
        const w1 = res.workouts[0];
        if (w1.date !== '2024-11-18' || w1.started !== '2024-11-18T07:00:00') {
            fails.push('parseStrongCsv: дата/время — ' + w1.date + ' ' + w1.started);
        }
        /* 1h 6m 25s от 07:00:00 → 08:06:25 */
        if (w1.ended !== '2024-11-18T08:06:25') fails.push('parseStrongCsv: ended из Duration — ' + w1.ended);
        if (w1.finished !== true || w1.title !== 'Full Gym' || w1.nutrition !== '') {
            fails.push('parseStrongCsv: finished/title/nutrition — ' + JSON.stringify([w1.finished, w1.title, w1.nutrition]));
        }
        const bench = w1.exercises[0];
        if (bench.name !== RU_BENCH) fails.push('parseStrongCsv: упражнение — ' + bench.name);
        /* SET ORDER 2,1,3 в файле → сортировка 1,2,3 → три одинаковых подряд схлопнулись */
        if (bench.sets.length !== 1 || bench.sets[0].w !== '60' || bench.sets[0].s !== 3 || bench.sets[0].r !== '8') {
            fails.push('parseStrongCsv: схлопывание 60×8×3 — ' + JSON.stringify(bench.sets));
        }
        if (w1.exercises[1].name !== 'Bench Press (Barbell)' || w1.exercises[1].sets[0].w !== '62.5') {
            fails.push('parseStrongCsv: второе упражнение — ' + JSON.stringify(w1.exercises[1]));
        }
        const w2 = res.workouts[1];
        if (w2.started !== '2024-11-19T18:30:00') fails.push('parseStrongCsv: секунды в дате — ' + w2.started);
        if (w2.ended !== '2024-11-19T19:05:00') fails.push('parseStrongCsv: голая длительность = минуты — ' + w2.ended);
        /* «Свои»: английские имена не из каталога с числом тренировок; известное имя не в списке */
        const un = res.unknown.map(function (u) { return u.name; });
        if (un.indexOf('Bench Press (Barbell)') < 0 || un.indexOf('Lat Pulldown') < 0) {
            fails.push('parseStrongCsv: unknown без английских имён: ' + JSON.stringify(res.unknown));
        }
        if (un.indexOf(RU_BENCH) >= 0) fails.push('parseStrongCsv: известное имя попало в unknown');
        const bbCnt = res.unknown.filter(function (u) { return u.name === 'Bench Press (Barbell)'; })[0];
        if (!bbCnt || bbCnt.cnt !== 1) fails.push('parseStrongCsv: cnt по тренировкам — ' + JSON.stringify(bbCnt));
        /* сводка: 2 тренировки, подходов 3+1+1 = 5, период по датам, 3 разных упражнения */
        if (res.stats.count !== 2 || res.stats.sets !== 5 || res.stats.minDate !== '2024-11-18' || res.stats.maxDate !== '2024-11-19') {
            fails.push('parseStrongCsv: stats — ' + JSON.stringify(res.stats));
        }
        if (res.stats.exCount !== 3) fails.push('parseStrongCsv: exCount — ' + res.stats.exCount);

        /* дубликаты дат: «оба + предупреждение» (§В.5) — ничего не пропускаем */
        const resDup = S.parseStrongCsv(csvOk, { unit: 'kg', existingDates: { '2024-11-18': true, '2020-01-01': true } });
        if (resDup.dupDates.length !== 1 || resDup.dupDates[0] !== '2024-11-18') {
            fails.push('parseStrongCsv: dupDates — ' + JSON.stringify(resDup.dupDates));
        }
        if (resDup.workouts.length !== 2) fails.push('parseStrongCsv: дубликат даты не должен пропускать тренировку');
    }

    /* единицы: фунты → кг до 0.5; Weight Unit строки сильнее сегмента; запятая-десятичная */
    const csvLb = HEAD +
        '2024-11-18 07:00,Gym,,Squat,1,100,5,,,lbs\n' + /* 100 lb → 45.36 → 45.5 */
        '2024-11-18 07:00,Gym,,Squat,2,100,5,,,lbs\n' + /* и схлопывание одинаковых */
        '2024-11-18 07:00,Gym,,Bench,1,80,5,,,kg\n' +   /* kg в строке сильнее сегмента lb */
        '2024-11-18 07:00,Gym,,Row,1,"80,5",5,,,\n';    /* колонки Unit нет → сегмент lb */
    const resLb = S.parseStrongCsv(csvLb, { unit: 'lb' });
    if (resLb.status !== 'ok') {
        fails.push('parseStrongCsv lb: status ' + resLb.status);
    } else {
        const sq = resLb.workouts[0].exercises.find(function (e) { return e.name === 'Squat'; });
        if (!sq || sq.sets.length !== 1 || sq.sets[0].w !== '45.5' || sq.sets[0].s !== 2) {
            fails.push('parseStrongCsv: фунты → кг (100 lb → 45.5) со схлопыванием — ' + JSON.stringify(sq && sq.sets));
        }
        const be = resLb.workouts[0].exercises.find(function (e) { return e.name === 'Bench'; });
        if (!be || be.sets[0].w !== '80') fails.push('parseStrongCsv: Weight Unit kg сильнее сегмента lb — ' + JSON.stringify(be && be.sets));
        const rw = resLb.workouts[0].exercises.find(function (e) { return e.name === 'Row'; });
        /* 80,5 lb = 36.5148 кг → округление до 0.5 → 36.5 */
        if (!rw || rw.sets[0].w !== '36.5') fails.push('parseStrongCsv: сегмент lb + запятая-десятичная — ' + JSON.stringify(rw && rw.sets));
    }

    /* пропуски с причинами и номерами строк (заголовок = строка 1); пустой вес → вес тела */
    const csvSkip = HEAD +
        '2024-11-18 07:00,Gym,,Push-up,1,,15,,,\n' +      /* ок: вес тела */
        '2024-11-18 07:00,Gym,,Plank,2,30,0,,,\n' +       /* строка 3: пустые повторения */
        '2024-11-18 07:00,Gym,,Treadmill,3,,,5.5,,\n' +   /* строка 4: кардио (дистанция) */
        '2024-11-18 07:00,Gym,,Treadmill,4,,,,25:00,\n' + /* строка 5: кардио (время) */
        '2024-11-18 07:00,Gym,,No Name Row,5,40,8,,,\n' + /* ок */
        ',Gym,,Ghost Row,6,40,8,,,\n' +                   /* строка 7: не прочитать дату */
        '2024-11-18 07:00,Gym,,,7,40,8,,,\n';             /* строка 8: нет названия упражнения */
    const resSkip = S.parseStrongCsv(csvSkip, { unit: 'kg' });
    if (resSkip.status !== 'ok') {
        fails.push('parseStrongCsv skip-файл: status ' + resSkip.status);
    } else {
        const w = resSkip.workouts[0];
        const pu = w.exercises.find(function (e) { return e.name === 'Push-up'; });
        if (!pu || pu.sets[0].w !== '') fails.push('parseStrongCsv: пустой вес → вес тела — ' + JSON.stringify(pu && pu.sets));
        const whys = resSkip.skipped.map(function (s) { return s.why; }).join(' | ');
        if (resSkip.skipped.length !== 5) {
            fails.push('parseStrongCsv: ожидалось 5 пропусков, есть ' + resSkip.skipped.length + ' (' + whys + ')');
        }
        if (whys.indexOf('кардио-подход (время/дистанция) не переносится') < 0) fails.push('parseStrongCsv: кардио-причина не найдена: ' + whys);
        if (whys.indexOf('пустые повторения') < 0) fails.push('parseStrongCsv: причина «пустые повторения» не найдена: ' + whys);
        if (whys.indexOf('нет названия упражнения') < 0) fails.push('parseStrongCsv: причина «нет названия» не найдена: ' + whys);
        if (whys.indexOf('не удалось прочитать дату') < 0) fails.push('parseStrongCsv: причина «не прочитать дату» не найдена: ' + whys);
        const ln = resSkip.skipped.map(function (s) { return s.line; }).sort(function (a, b) { return a - b; }).join(',');
        if (ln !== '3,4,5,7,8') fails.push('parseStrongCsv: номера строк пропусков — ' + ln);
        if (w.exercises.some(function (e) { return e.name === 'Treadmill'; })) {
            fails.push('parseStrongCsv: кардио-строки не должны попадать в тренировку');
        }
    }

    /* ошибки формата: чужой CSV (Э7) и файл без данных (Э8) */
    const r1 = S.parseStrongCsv('name,amount\nМолоко,2\n', { unit: 'kg' });
    if (r1.status !== 'notstrong') fails.push('parseStrongCsv: чужой CSV — ' + r1.status);
    const r2 = S.parseStrongCsv(HEAD, { unit: 'kg' });
    if (r2.status !== 'empty') fails.push('parseStrongCsv: только заголовки — ' + r2.status);
    const r3 = S.parseStrongCsv('Date,Exercise Name,Reps\n2024-01-01,Push-up,0\n', { unit: 'kg' });
    if (r3.status !== 'empty') fails.push('parseStrongCsv: строки без структуры → empty — ' + r3.status);

    /* две тренировки в один день: разное время/название — обе переносятся (§4.6) */
    const csvTwo = HEAD +
        '2024-11-18 07:00,Morning,1h,' + RU_BENCH + ',1,60,8,,,kg\n' +
        '2024-11-18 19:00,Evening,1h,' + RU_BENCH + ',1,80,8,,,kg\n';
    const r4 = S.parseStrongCsv(csvTwo, { unit: 'kg' });
    if (r4.status !== 'ok' || r4.workouts.length !== 2) {
        fails.push('parseStrongCsv: две тренировки одного дня — ' + r4.status + ' ' + (r4.workouts || []).length);
    }
} catch (e) {
    fails.push('юниты Strong-парсера не выполняются: ' + e.message);
}
if (fails.length) {
    console.error('ПРОВАЛ (' + fails.length + '):\n - ' + fails.join('\n - '));
    process.exit(1);
}
console.log('CHECK OK');
