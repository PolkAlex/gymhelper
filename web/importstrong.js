/* ============ [ONB-T9] парсер CSV-выгрузки Strong (клиентский, без библиотек) ============
   Спека: docs/spec-onb-s6-import.md (ред. 2): §В.2 — разбор целиком на клиенте; §В.3 —
   маппинг колонок по именам, схлопывание подряд одинаковых подходов; §В.4 — незнакомые
   каталогу имена остаются «Своими» существующей механикой (isCustomEx); §В.5 — дубликаты
   дат: «оба + предупреждение». Подключается в index.html как catalog.js (classic script,
   глобальный STRONG). Юниты — tests/check.js, e2e — tests/e2e.spec.js [ONB-T10].
   Сервер/бот/формат данных не меняются: на выходе стандартные Workout/ExerciseEntry/SetEntry
   (id проставляет app.js из G.nextId — здесь всегда id: 0). */
(function (glob) {
    'use strict';

    function pad2(n) { return (n < 10 ? '0' : '') + n; }

    /* --- CSV: кавычки, запятые/переводы строк внутри значений, ""-экранирование;
       BOM игнор; разделитель распознаём по первой строке (, против ;) — Excel-локали --- */
    function parseCsv(text) {
        if (typeof text !== 'string') text = String(text || '');
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); /* BOM */
        const nl = text.indexOf('\n');
        const first = nl >= 0 ? text.slice(0, nl) : text;
        let commas = 0, semis = 0, q = false;
        for (let i = 0; i < first.length; i++) {
            const ch = first[i];
            if (ch === '"') q = !q;
            else if (!q && ch === ',') commas++;
            else if (!q && ch === ';') semis++;
        }
        const D = semis > commas ? ';' : ',';
        const rows = [];
        let row = [], cur = '', inQ = false;
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (inQ) {
                if (c === '"') {
                    if (text[i + 1] === '"') { cur += '"'; i++; }
                    else inQ = false;
                } else cur += c;
            } else if (c === '"') inQ = true;
            else if (c === D) { row.push(cur); cur = ''; }
            else if (c === '\n') { row.push(cur); cur = ''; rows.push(row); row = []; }
            else if (c !== '\r') cur += c;
        }
        if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
        /* полностью пустые строки (в т.ч. хвостовой перевод строки) — не данные */
        return rows.filter(function (r) { return r.length > 1 || (r.length === 1 && r[0].trim() !== ''); });
    }

    /* «80,5» → 80.5; мусор → null */
    function parseNum(s) {
        const t = String(s == null ? '' : s).trim().replace(',', '.');
        if (!t || !/^-?\d+(?:\.\d+)?$/.test(t)) return null;
        const v = parseFloat(t);
        return isFinite(v) ? v : null;
    }

    /* Дата Strong: «2024-11-18 07:00», допускаем слэши/точки и секунды (§В.3);
       без времени → 00:00 (не влияет на дату). → {date:'YYYY-MM-DD', time:'HH:MM'} | null */
    function parseStrongDate(s) {
        const m = /(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(String(s || '').trim());
        if (!m) return null;
        const mo = +m[2], d = +m[3];
        if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
        const h = m[4] != null ? Math.min(+m[4], 23) : 0;
        const mi = m[5] != null ? Math.min(+m[5], 59) : 0;
        return { date: m[1] + '-' + pad2(mo) + '-' + pad2(d), time: pad2(h) + ':' + pad2(mi) };
    }

    /* Duration: «1h 6m 25s» / «35 min» / голое число = минуты / «1:06:25». → секунды | null */
    function parseDuration(s) {
        const t = String(s == null ? '' : s).trim().toLowerCase();
        if (!t) return null;
        const hm = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(t);
        if (hm) return (+hm[1]) * 3600 + (+hm[2]) * 60 + (hm[3] ? +hm[3] : 0);
        let sec = 0, any = false;
        const re = /(\d+(?:[.,]\d+)?)\s*(h|hr|hours?|ч|m|min|mins?|м|s|sec|secs?|с|c)?/g;
        let m;
        while ((m = re.exec(t)) !== null) {
            const v = parseFloat(m[1].replace(',', '.'));
            if (!isFinite(v)) continue;
            any = true;
            const u = (m[2] || '').charAt(0);
            if (u === 'h' || u === 'ч') sec += v * 3600;
            else if (u === 's' || u === 'с' || u === 'c') sec += v;
            else sec += v * 60; /* m/min/мин или голое число — минуты */
        }
        return any ? Math.round(sec) : null;
    }

    /* Вес подхода (§В.3): кг — как есть; фунты → ×0.4536 с округлением до 0.5 (как в
       ручном вводе). Колонка Weight Unit, если есть, сильнее сегмента (в одной выгрузке
       единицы не смешиваются, но верить файлу честнее). Пусто/0 → '' (вес тела).
       Формат — строка с точкой ('60', '62.5'): entryLine сам рисует запятую. */
    function toWeightKg(raw, unit, rowUnit) {
        const v = parseNum(raw);
        if (!(v > 0)) return '';
        const ru = String(rowUnit || '').trim().toLowerCase();
        const useLb = ru ? (ru === 'lbs' || ru === 'lb' || ru === 'фунты') : (unit === 'lb');
        const kg = useLb ? Math.round(v * 0.4536 * 2) / 2 : v;
        return String(Math.round(kg * 10) / 10);
    }

    /* Заголовки сопоставляем ПО ИМЕНАМ (не по позициям), регистр/пробелы — игнор (§В.3) */
    const HEADS = {
        date: ['date'], wname: ['workout name'], dur: ['duration'],
        ex: ['exercise name'], order: ['set order', 'setorder'],
        weight: ['weight'], reps: ['reps'], dist: ['distance'],
        time: ['time'], wunit: ['weight unit']
    };
    function mapHeaders(row) {
        const low = row.map(function (c) { return String(c || '').trim().toLowerCase(); });
        const idx = {};
        for (const k in HEADS) {
            idx[k] = -1;
            for (const h of HEADS[k]) { const i = low.indexOf(h); if (i >= 0) { idx[k] = i; break; } }
        }
        return idx;
    }
    function cell(r, i) { return i >= 0 && i < r.length ? String(r[i]).trim() : ''; }

    /* Схлопывание подряд одинаковых (§В.3): соседние подходы с тем же весом и повторами
       60×8, 60×8, 60×8 → SetEntry w=60, s=3, r=8; разные рядом (60×8, 62.5×8) остаются */
    function collapse(rows) {
        const out = [];
        for (const row of rows) {
            const last = out[out.length - 1];
            const sameW = last != null && parseFloat(last.w || '0') === parseFloat(row.w || '0');
            if (last && sameW && String(last.r) === String(row.r)) last.s++;
            else out.push({ w: row.w, s: 1, r: row.r });
        }
        return out;
    }

    function addSeconds(iso, sec) {
        const d = new Date(iso);
        d.setSeconds(d.getSeconds() + sec);
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
            'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
    }

    /* --- главный вход: text CSV → результат разбора (синхронный: несколько МБ — доли
       секунды; кадры прогресса UI рисует до/после разбора через setTimeout) ---
       opts: { unit: 'kg'|'lb' — сегмент с шага выбора,
               existingDates: {'YYYY-MM-DD': true} — даты дневника для плашки дублей (§В.5) }
       → { status:'ok', workouts, skipped, stats, unknown, dupDates }
         | { status:'notstrong' } — нет узнаваемых колонок (Э7)
         | { status:'empty' } — заголовки Strong есть, тренировок не собрали (Э8)
       workouts — БЕЗ id (их выдаёт app.js из G.nextId), все finished:true, nutrition ''. */
    function parseStrongCsv(text, opts) {
        opts = opts || {};
        const rows = parseCsv(text);
        if (!rows.length) return { status: 'notstrong' };
        const hi = mapHeaders(rows[0]);
        if (hi.date < 0 || hi.ex < 0) return { status: 'notstrong' }; /* нет Date/Exercise Name */
        const total = rows.length - 1;
        if (total <= 0) return { status: 'empty' }; /* только заголовки */

        /* группировка: одна строка CSV = один подход; тренировка = блок строк с одной
           датой-временем и названием (несколько тренировок дня различаются временем) */
        const groups = new Map();
        const skipped = [];
        for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            const line = i + 1; /* «строка N» в результате: заголовок = строка 1 */
            const exName = cell(r, hi.ex);
            if (!exName) { skipped.push({ line: line, why: 'нет названия упражнения' }); continue; }
            const dt = parseStrongDate(cell(r, hi.date));
            if (!dt) { skipped.push({ line: line, why: 'не удалось прочитать дату' }); continue; }
            const reps = parseNum(cell(r, hi.reps));
            if (!(reps > 0)) {
                /* кардио: Distance/Time есть, повторений нет (§В.3, §4.6) */
                const cardio = (hi.dist >= 0 && (parseNum(cell(r, hi.dist)) || 0) > 0) ||
                    (hi.time >= 0 && (parseNum(cell(r, hi.time)) || 0) > 0);
                skipped.push({ line: line, why: cardio ? 'кардио-подход (время/дистанция) не переносится' : 'пустые повторения' });
                continue;
            }
            const title = cell(r, hi.wname);
            const key = cell(r, hi.date) + '\u0001' + title;
            let g = groups.get(key);
            if (!g) {
                g = {
                    date: dt.date, time: dt.time, title: title,
                    dur: hi.dur >= 0 ? parseDuration(cell(r, hi.dur)) : null,
                    exs: new Map()
                };
                groups.set(key, g);
            }
            let ex = g.exs.get(exName);
            if (!ex) { ex = { name: exName, rows: [] }; g.exs.set(exName, ex); }
            const order = hi.order >= 0 ? (parseNum(cell(r, hi.order)) || (ex.rows.length + 1)) : (ex.rows.length + 1);
            ex.rows.push({ w: toWeightKg(cell(r, hi.weight), opts.unit, hi.wunit >= 0 ? cell(r, hi.wunit) : ''), r: String(cell(r, hi.reps)), order: order });
        }
        if (!groups.size) return { status: 'empty' }; /* строки есть — структуры нет (§4.3) */

        /* сборка тренировок: упражнения в порядке появления, подходы по SET ORDER */
        /* findCatalog (catalog.js) резолвим через область видимости: в браузере это глобал,
           в юнитах check.js — замыкание Function(cat+imp); typeof — безопасно при отсутствии */
        const findC = typeof findCatalog !== 'undefined' ? findCatalog : (glob.findCatalog || null);
        const workouts = [];
        const unknownCnt = new Map();
        let setsTotal = 0, minD = null, maxD = null;
        const seenDates = [];
        for (const g of groups.values()) {
            const started = g.date + 'T' + g.time + ':00';
            const ended = g.dur != null ? addSeconds(started, g.dur) : '';
            const exercises = [];
            for (const ex of g.exs.values()) {
                ex.rows.sort(function (a, b) { return a.order - b.order; });
                const sets = collapse(ex.rows);
                if (!sets.length) continue;
                exercises.push({ name: ex.name, st: started, en: ended, sets: sets });
                for (const s of sets) setsTotal += s.s;
                if (findC && !findC(ex.name)) unknownCnt.set(ex.name, (unknownCnt.get(ex.name) || 0) + 1);
            }
            if (!exercises.length) continue;
            workouts.push({
                id: 0, date: g.date, started: started, ended: ended,
                finished: true, title: g.title, nutrition: '', exercises: exercises
            });
            if (seenDates.indexOf(g.date) < 0) seenDates.push(g.date);
            if (minD === null || g.date < minD) minD = g.date;
            if (maxD === null || g.date > maxD) maxD = g.date;
        }
        if (!workouts.length) return { status: 'empty' };

        /* «Свои» — имена не из каталога, с числом тренировок на каждое (Э5); топ по частоте */
        const unknown = Array.from(unknownCnt.keys()).map(function (n) { return { name: n, cnt: unknownCnt.get(n) }; });
        unknown.sort(function (a, b) { return b.cnt - a.cnt || (a.name < b.name ? -1 : 1); });

        /* дубликаты дат: совпадение с дневником на момент разбора (§В.5) — оба + плашка */
        const dupDates = (opts.existingDates ? Object.keys(opts.existingDates) : [])
            .filter(function (d) { return seenDates.indexOf(d) >= 0; })
            .sort().reverse(); /* свежие сверху, как в макете Э5 */

        return {
            status: 'ok',
            workouts: workouts,
            skipped: skipped,
            stats: { count: workouts.length, sets: setsTotal, exCount: countEx(workouts), minDate: minD, maxDate: maxD },
            unknown: unknown,
            dupDates: dupDates
        };
    }

    /* всего разных упражнений (в т.ч. известных каталогу) — для строки «📚 K упражнений» */
    function countEx(workouts) {
        const set = new Set();
        for (const w of workouts) for (const e of w.exercises) set.add(e.name);
        return set.size;
    }

    glob.STRONG = { parseCsv: parseCsv, parseStrongCsv: parseStrongCsv };
})(typeof window !== 'undefined' ? window : globalThis);
