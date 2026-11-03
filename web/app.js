'use strict';

const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
let INIT = '';
let G = null;
let tab = 'workout';
let viewWid = 0;
let modalCtx = null;
let PENDING = null;
let SUG_W = [];
let SUG_R = [];
let CUR = null;
let PICKER = null;
let TECH = { section: 'all', cat: null, open: null };
let profileSex = 'м';
let editSnap = null;
let pendingTab = null;
let __delExerciseCtx = null;
let __delSetCtx = null;
let railOpen = false;

const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const THEMES = [
    { id: 'sage', name: 'Шалфей', dots: ['#f6f3ec', '#fdfbf6', '#87a592'] },
    { id: 'forest', name: 'Тёмный лес', dots: ['#20211c', '#2a2b24', '#87a592'] },
    { id: 'khaki', name: 'Хаки', dots: ['#1e211a', '#262a20', '#9caf7a'] },
    { id: 'pine', name: 'Хвоя', dots: ['#141f19', '#1b2921', '#7fae94'] },
    { id: 'peach', name: 'Персик', dots: ['#fdf1e7', '#fffaf4', '#d99a7a'] },
    { id: 'lavender', name: 'Лаванда', dots: ['#f4f1fa', '#fdfcff', '#9a8cc4'] },
    { id: 'rose', name: 'Пудра', dots: ['#fbf0f2', '#fff8fa', '#cf8ba0'] },
    { id: 'mint', name: 'Мята', dots: ['#eef6f1', '#fbfefb', '#6aa88f'] },
    { id: 'ice', name: 'Голубой лёд', dots: ['#eef3f7', '#fbfdff', '#7397b5'] },
    { id: 'graphite', name: 'Графит', dots: ['#1c1d1f', '#26272a', '#8d9db6'] },
    { id: 'coffee', name: 'Кофе с молоком', dots: ['#efe7dc', '#faf5ee', '#b08b68'] },
    { id: 'midnight', name: 'Полночь', dots: ['#171c26', '#1f2532', '#7d95c9'] },
    { id: 'stockline', name: 'Stockline', dots: ['#16181d', '#1e2228', '#3ddc97'] }
];

/* ============ утилиты ============ */
function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function pad2(n) { return String(n).padStart(2, '0'); }
function fmtW(w) {
    if (w == null || isNaN(w)) return '0';
    return Number.isInteger(+w) ? String(+w) : String(w);
}
function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function nowLocalISO() {
    const d = new Date();
    return todayISO() + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}
function parseDateISO(s) {
    if (!s) return null;
    const p = String(s).split('-');
    if (p.length < 3) return null;
    return new Date(+p[0], +p[1] - 1, +p[2]);
}
function firstLine(w) {
    const d = parseDateISO(w.date);
    if (!d) return w.date || 'Тренировка';
    return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + ', ' + DOW[(d.getDay() + 6) % 7];
}
function titleLines(w) {
    if (w.title && w.title.trim()) return w.title.split('\n').map(s => s.trim()).filter(Boolean);
    const lines = [firstLine(w)];
    let n = 0;
    for (const e of (w.exercises || [])) {
        if (!e.sets || !e.sets.length) continue;
        lines.push(e.name);
        if (++n === 3) break;
    }
    return lines;
}
function maxNum(t) {
    let max = 0;
    const re = /(\d+(?:[.,]\d+)?)/g;
    let m;
    while ((m = re.exec(t || '')) !== null) {
        const v = parseFloat(m[1].replace(',', '.'));
        if (v > max) max = v;
    }
    return max;
}
function repsNum(r) {
    const m = /(\d+(?:[.,]\d+)?)/.exec(r || '');
    return m ? Math.round(parseFloat(m[1].replace(',', '.'))) : 10;
}
function maxWeightOf(e) {
    let max = 0;
    for (const s of e.sets) max = Math.max(max, maxNum(s.w));
    return max;
}
function setsCount(e) {
    let n = 0;
    for (const s of e.sets) n += +s.s || 0;
    return n;
}
function workoutVolume(w) {
    let v = 0;
    for (const e of (w.exercises || [])) {
        for (const s of e.sets) v += maxNum(s.w) * (+s.s || 0) * repsNum(s.r);
    }
    return v;
}
function durationMin(w) {
    if (!w.started) return null;
    const s = new Date(w.started);
    const end = (w.finished && w.ended) ? new Date(w.ended) : new Date();
    return Math.max(Math.round((end - s) / 60000), 0);
}
function durationText(mins) {
    const h = Math.floor(mins / 60), m = mins % 60;
    if (h > 0 && m > 0) return h + ' ч ' + m + ' м';
    if (h > 0) return h + ' ч';
    return m + ' м';
}
function setsWord(n) {
    n = Math.abs(+n || 0);
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'подход';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'подхода';
    return 'подходов';
}
function bmr(p) {
    const base = 10 * p.weight + 6.25 * p.height - 5 * p.age;
    return p.sex === 'ж' ? base - 161 : base + 5;
}
function activeW() { return G.workouts.find(w => !w.finished) || null; }
function findW(id) { return G.workouts.find(w => w.id === id) || null; }
function prevOf(w) {
    const i = G.workouts.indexOf(w);
    return i > 0 ? G.workouts[i - 1] : null;
}
function findEx(w, name) {
    if (!w || name == null) return null;
    return w.exercises.find(e => e.name.toLowerCase() === String(name).toLowerCase()) || null;
}
function lastWorkoutWith(name) {
    let last = null;
    for (const w of G.workouts) {
        const e = findEx(w, name);
        if (e && e.sets.length) last = w;
    }
    return last;
}
function lastWeights(name) {
    const last = lastWorkoutWith(name);
    const out = [];
    if (!last) return out;
    const e = findEx(last, name);
    for (const s of e.sets) {
        if (s.w && !out.includes(s.w)) out.push(s.w);
        if (out.length >= 4) break;
    }
    return out;
}
function lastReps(name) {
    const last = lastWorkoutWith(name);
    const out = [];
    if (!last) return out;
    const e = findEx(last, name);
    for (const s of e.sets) {
        if (!out.includes(s.r)) out.push(s.r);
        if (out.length >= 4) break;
    }
    return out;
}
function popularWeight(name) {
    const cnt = {};
    for (const w of G.workouts) {
        const e = findEx(w, name);
        if (!e) continue;
        for (const s of e.sets) {
            if (!s.w) continue;
            cnt[s.w] = (cnt[s.w] || 0) + 1;
        }
    }
    let best = null, bc = 0;
    for (const k in cnt) {
        if (cnt[k] >= bc) { bc = cnt[k]; best = k; }
    }
    return best;
}
function entryLine(s) {
    const repsPart = /\d/.test(String(s.r)) ? ' по ' + s.r + ' повторений' : ' по ' + s.r;
    return (s.w ? s.w + ' кг, ' : '') + s.s + ' ' + setsWord(s.s) + repsPart;
}
function isCustomEx(name) {
    return !findCatalog(name);
}
function dayPart(w) {
    if (!w.started) return null;
    const hh = +String(w.started).slice(11, 13);
    if (hh < 12) return { n: 'утро', i: '🌅' };
    if (hh < 18) return { n: 'день', i: '☀️' };
    return { n: 'вечер', i: '🌙' };
}
function isWarmupName(name) {
    const c = findCatalog(name);
    return c ? c.t.includes('warmup') : /^разминка/i.test(name);
}

/* ============ тайминг и калории ============ */
function closeCurrentExercise() {
    if (!CUR) return;
    const w = findW(CUR.wid);
    const e = w ? findEx(w, CUR.name) : null;
    if (e && !e.en) e.en = nowLocalISO();
    CUR = null;
}
function startExercise(w, name) {
    let e = findEx(w, name);
    if (!e) {
        e = { name, sets: [], st: nowLocalISO(), en: '' };
        w.exercises.push(e);
    } else if (!e.st) {
        e.st = nowLocalISO();
    }
    CUR = { wid: w.id, name };
    return e;
}
function exMinutes(e) {
    if (!e.st) return null;
    const s = new Date(e.st);
    const end = e.en ? new Date(e.en) : new Date();
    return Math.max(Math.round((end - s) / 60000), 0);
}
function exStats(e) {
    if (!e.st) return null;
    const mins = exMinutes(e);
    let restSec = null;
    const ts = (e.sets || []).map(x => x.t ? new Date(x.t) : null).filter(Boolean);
    if (ts.length >= 2) {
        let tot = 0, cnt = 0;
        for (let i = 1; i < ts.length; i++) {
            const d = (ts[i] - ts[i - 1]) / 1000;
            if (d > 0 && d < 1800) { tot += d; cnt++; }
        }
        if (cnt) restSec = Math.round(tot / cnt);
    }
    return { mins, restSec };
}
function calcWorkoutKcal(p, w) {
    if (!p || !(p.weight > 0)) return null;
    const exs = (w.exercises || []).filter(e => e.sets.length);
    if (!exs.length) return { total: 0, lines: [] };
    const anyTiming = exs.some(e => e.st);
    const totalSets = exs.reduce((a, e) => a + e.sets.length, 0) || 1;
    const wmin = durationMin(w);
    let total = 0;
    const lines = [];
    for (const e of exs) {
        const met = exMet(e.name);
        let m = anyTiming ? exMinutes(e) : (wmin != null ? wmin * e.sets.length / totalSets : null);
        let kcal = null;
        if (m != null && m > 0) {
            const cm = Math.min(m, 120);
            kcal = Math.round(met * 3.5 * p.weight / 200 * cm);
            total += kcal;
        }
        lines.push({ name: e.name, m, met, kcal });
    }
    const sum = lines.reduce((a, l) => a + (l.m || 0), 0);
    if (wmin != null && sum > wmin && sum > 0) {
        const k = wmin / sum;
        total = 0;
        for (const l of lines) {
            if (l.kcal != null) { l.kcal = Math.round(l.kcal * k); total += l.kcal; }
            if (l.m != null) l.m = Math.round(l.m * k);
        }
    }
    return { total, lines };
}

/* ============ сохранение (очередь) ============ */
let __saveChain = Promise.resolve();
let __saveBusy = false;
function save() {
    const run = __saveChain.then(function () { return doSave(); });
    __saveChain = run.catch(function () { });
    return run;
}
async function doSave() {
    __saveBusy = true;
    try {
        const r = await fetch('/api/save', {
            method: 'POST',
            body: JSON.stringify({ initData: INIT, rev: G.rev || 0, data: G })
        });
        let j = {};
        try { j = await r.json(); } catch (e2) { /* noop */ }
        if (j.ok && typeof j.rev === 'number') { G.rev = j.rev; return 'ok'; }
        console.error('save failed', r.status);
        toast('Ошибка сохранения: сервер ответил ' + r.status, true);
        return 'err';
    } catch (e) {
        console.error('save failed', e);
        toast('Ошибка сохранения: нет связи с сервером', true);
        return 'err';
    } finally {
        __saveBusy = false;
    }
}
async function reloadSilently(force) {
    if (!force && __saveBusy) return;
    if (!force && tab === 'history' && viewWid) return;
    try {
        const r = await fetch('/api/init', {
            method: 'POST',
            body: JSON.stringify({ initData: INIT })
        });
        const j = await r.json();
        if (j.ok && j.data) {
            /* не теряем локальные тренировки, которых сервер ещё не видел (сбой сохранения) */
            const serverIds = new Set((j.data.workouts || []).map(w => w.id));
            const serverDel = new Set(j.data.del || []);
            const localOnly = G ? G.workouts.filter(w => !serverIds.has(w.id) && !serverDel.has(w.id)) : [];
            const localNextId = G ? G.nextId : 0;
            G = j.data;
            for (const w of localOnly) {
                G.workouts.push(w);
                if (w.id >= G.nextId) G.nextId = w.id + 1;
            }
            if (!G.workouts) G.workouts = [];
            if (!G.del) G.del = [];
            /* nextId не откатывается ниже локально известного — защита от id-коллизий */
            if (G.nextId < localNextId) G.nextId = localNextId;
            for (const w of G.workouts) if (w.id >= G.nextId) G.nextId = w.id + 1;
            for (const d of (G.del || [])) if (d >= G.nextId) G.nextId = d + 1;
            if (G.nextId < 1) G.nextId = 1;
            if (G.profile) profileSex = G.profile.sex;
            render();
        }
    } catch (e) { /* noop */ }
}
document.addEventListener('visibilitychange', function () {
    if (!document.hidden && !(tab === 'history' && viewWid)) reloadSilently();
});
window.addEventListener('focus', function () {
    if (!(tab === 'history' && viewWid)) reloadSilently();
});

/* ============ доставка действий ============ */
function dispatchFromEl(el, ev) {
    const act0 = el.getAttribute('data-act');
    /* цифровая панель: без дедупа — быстрые повторные тапы по одной цифре легальны */
    if (act0 !== 'kpIns' && act0 !== 'kpDel' && Date.now() - (el.__gymFired || 0) < 400) return;
    el.__gymFired = Date.now();
    const fav = el.getAttribute('data-fav');
    if (fav) { toggleFav(fav); return; }
    const act = el.getAttribute('data-act');
    if (act === 'modalBackdrop') {
        if (!ev || ev.target === el) closeModal();
        return;
    }
    const fn = ACTIONS[act];
    if (typeof fn === 'function') {
        fn(el.getAttribute('data-a'), el.getAttribute('data-b'), el.getAttribute('data-c'));
    }
}
window.addEventListener('click', function (ev) {
    const el = ev.target && ev.target.closest ? ev.target.closest('[data-fav],[data-act]') : null;
    if (el) dispatchFromEl(el, ev);
}, true);

/* тап vs скролл: действие только для чистого тапа (без движения, короче 500 мс) */
let __tap = null;
document.addEventListener('touchstart', function (ev) {
    if (ev.touches.length > 1) { __tap = null; return; }
    const t = ev.touches[0];
    __tap = { x: t.clientX, y: t.clientY, time: Date.now(), moved: false };
}, { passive: true });
document.addEventListener('touchmove', function (ev) {
    if (!__tap) return;
    const t = ev.touches && ev.touches[0];
    if (!t) return;
    if (Math.abs(t.clientX - __tap.x) > 15 || Math.abs(t.clientY - __tap.y) > 15) __tap.moved = true;
}, { passive: true });
document.addEventListener('touchend', function (ev) {
    const info = __tap;
    __tap = null;
    const t = ev.target;
    if (t && t.closest && t.closest('input,textarea')) return; /* поля ввода: не мешаем фокусу и каретке */
    const el = t && t.closest ? t.closest('[data-fav],[data-act]') : null;
    if (!el) return;
    if (!info || info.moved || Date.now() - info.time > 500) return; /* это был скролл, не тап */
    if (ev.cancelable) ev.preventDefault();
    dispatchFromEl(el, ev);
}, false);
window.addEventListener('error', function (ev) {
    dbgMsg('ОШИБКА JS: ' + (ev && ev.message || '?') + ' @' + (ev && ev.lineno || '?'));
});
function dbgMsg(t) {
    const d = document.getElementById('dbg');
    if (d) d.textContent = t;
}
let __toastTimer = null;
function toast(msg, isErr) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    if (__toastTimer) clearTimeout(__toastTimer);
    __toastTimer = setTimeout(function () { t.className = 'toast'; }, 2200);
}

/* ============ темы ============ */
function applyTheme(id) {
    document.documentElement.setAttribute('data-theme', id);
    try { localStorage.setItem('gymTheme', id); } catch (e) { /* noop */ }
    if (tg && tg.setHeaderColor) { try { tg.setHeaderColor('secondary_bg_color'); } catch (e2) { /* noop */ } }
}
function loadTheme() {
    let id = 'sage';
    try { id = localStorage.getItem('gymTheme') || 'sage'; } catch (e) { /* noop */ }
    applyTheme(id);
}

/* ============ ACTIONS ============ */
const ACTIONS = {
    switchTab: function (a) {
        tab = a; viewWid = 0; render();
    },
    openHistory: function (a) {
        editSnap = JSON.stringify(G);
        viewWid = +a;
        tab = 'history';
        render();
    },
    openEntryModal: function (a, b, c) { openEntryModal(+a, +b, +c); },
    closeHistory: function () {
        editSnap = null;
        viewWid = 0;
        render();
    },
    saveAndExit: async function () {
        closeModal();
        await save();
        editSnap = null;
        viewWid = 0;
        render();
    },
    discardExit: async function () {
        closeModal();
        await reloadSilently(true);
        editSnap = null;
        viewWid = 0;
        render();
    },
    saveWorkout: async function () {
        const r = await save();
        if (r === 'ok') toast('✓ Сохранено');
        render();
    },
    startWorkout: function () { startWorkout(); },
    finishWorkout: function (a) { finishWorkout(+a); },
    deleteWorkout: function (a) { deleteWorkout(+a); },
    openPicker: function (a) { openPicker(+a); },
    pickerSection: function (a) { if (PICKER) { PICKER.section = a; PICKER.cat = null; renderPickerChips(); renderPickerList(); } },
    pickerCat: function (a) { if (PICKER) { PICKER.cat = PICKER.cat === a ? null : a; renderPickerChips(); renderPickerList(); } },
    pickCatEx: function (a) { pickCatEx(a); },
    customExerciseModal: function () { customExerciseModal(); },
    createCustom: function () { createCustom(); },
    openTech: function (a) { TECH.open = a; render(); },
    techBack: function () { TECH.open = null; render(); },
    techSection: function (a) { TECH.section = a; TECH.cat = null; render(); },
    techCat: function (a) { TECH.cat = TECH.cat === a ? null : a; render(); },
    chipW: function (a) { chipW(+a); },
    chipR: function (a) { chipR(+a); },
    kpIns: function (a) { kpIns(a); },
    kpDel: function () { kpDel(); },
    saveEntry: async function () { await saveEntry(); },
    deleteEntry: async function () { await deleteEntry(); },
    renameExercise: function (a, b) { renameExercise(+a, +b); },
    doRename: async function () { await doRename(); },
    deleteExercise: function (a, b) { deleteExercise(+a, +b); },
    deleteExerciseGo: function () { deleteExerciseGo(); },
    deleteSet: function (a, b, c) { deleteSet(+a, +b, +c); },
    deleteSetGo: function () { deleteSetGo(); },
    nutrModal: function (a) { nutrModal(+a); },
    saveNutr: function (a) { saveNutr(+a); },
    clearNutr: function (a) { clearNutr(+a); },
    titleModal: function (a) { titleModal(+a); },
    saveTitle: function (a) { saveTitle(+a); },
    autoTitle: function (a) { autoTitle(+a); },
    timeModal: function (a) { timeModal(+a); },
    saveTime: function (a) { saveTime(+a); },
    confirmModal: function (a, b, c) { confirmModal(a, b, +c); },
    confirmYes: function () { confirmYes(); },
    setTheme: function (a) { applyTheme(a); render(); },
    setSex: function (a) { profileSex = a; render(); },
    saveProfile: function () { saveProfile(); },
    closeModal: function () { closeModal(); },
    modalBackdrop: function () { closeModal(); },
    pickBg: function () { const el = document.getElementById('bgFile'); if (el) el.click(); },
    clearBg: function () {
        try { localStorage.removeItem('gymBg'); } catch (e) { /* noop */ }
        document.documentElement.classList.remove('has-bg');
        toast('Фон убран');
    }
};

/* ============ каркас ============ */
function render() {
    const app = document.getElementById('app');
    let h = topbarHtml();
    if (tab === 'workout') h += renderWorkoutTab();
    if (tab === 'history') h += renderHistoryTab();
    if (tab === 'tech') h += renderTechTab();
    if (tab === 'stats') h += renderStatsTab();
    if (tab === 'coach') h += renderCoachTab();
    if (tab === 'profile') h += renderProfileTab();
    h += navHtml();
    if (tab === 'history' && viewWid && findW(viewWid)) {
        h += '<div class="backbar"><div class="ab-row">' +
            '<button class="btn prime" data-act="saveWorkout">💾 Сохранить</button>' +
            '<button class="btn sec" data-act="closeHistory">🚪 Выйти</button>' +
            '</div></div>';
        h += '<div style="height:70px"></div>';
    }
    if (tab === 'tech' && TECH.open) {
        h += '<div class="backbar"><button class="btn sec wide" data-act="techBack">↩️ К упражнениям</button></div>';
        h += '<div style="height:70px"></div>';
    }
    app.innerHTML = h;
    const nv = document.querySelector('.nav');
    if (nv && (window.scrollY || 0) > 60) nv.classList.add('min');
    if (tab === 'tech' && !TECH.open) {
        const q = document.getElementById('techQ');
        if (q) q.addEventListener('input', function () { TECH.q = this.value; const list = document.getElementById('techList'); if (list) list.innerHTML = techListHtml(); });
    }
    dbgMsg('rev ' + (G ? G.rev : '-'));
}
function navHtml() {
    const items = [
        ['coach', 'user', 'Тренер'],
        ['history', 'timer', 'История'],
        ['workout', 'dumbbell', 'Тренировка'],
        ['tech', 'pilates', 'Техника'],
        ['stats', 'chart', 'Статистика']
    ];
    return '<div class="nav">' + items.map(function (it) {
        return '<button class="' + (tab === it[0] ? 'on' : '') + '" data-act="switchTab" data-a="' + it[0] + '">' +
            '<span class="nwrap"><span class="nico">' + (ICONS[it[1]] || '') + '</span></span>' +
            '<span class="nlabel">' + it[2] + '</span></button>';
    }).join('') + '</div>';
}
function topbarHtml() {
    const names = { workout: 'Тренировка', history: 'История', coach: 'Тренер', tech: 'Техника', stats: 'Статистика', profile: 'Настройки' };
    return '<div class="topbar"><span class="tb-title">GymHelper · ' + names[tab] + '</span>' +
        '<button class="tb-user" data-act="switchTab" data-a="profile" title="Настройки">' + ico('user') + '</button></div>';
}

/* ---------- вкладка тренировки ---------- */
function renderWorkoutTab() {
    const fin = G.workouts.filter(w => w.finished);
    const unfin = G.workouts.filter(w => !w.finished).slice().reverse();
    const last = fin.length ? fin[fin.length - 1] : null;
    let h = heroHtml(fin);
    if (unfin.length) {
        h += '<div class="card" style="padding:10px"><p class="t1" style="font-size:15px">⚡ Незавершённые тренировки</p>';
        for (const w of unfin) {
            const dpw = dayPart(w);
            h += '<div class="wrow" data-act="openHistory" data-a="' + w.id + '">' +
                '<span class="ico">' + ICONS.timer + '</span>' +
                '<span class="wt"><div class="exn">' + (dpw ? '<span class="dp-inline">' + dpw.i + '</span> ' : '') + esc(firstLine(w)) + '</div></span>' +
                '<span class="badge">открыть</span></div>';
        }
        h += '</div>';
    }
    if (last) h += '<div class="card"><p class="t1">👀 Последняя тренировка</p>' + previewCard(last) + '</div>';
    if (!G.workouts.length) h += '<p class="empty">Пока пусто. Начни первую тренировку! 💪</p>';
    return h;
}
function heroHtml(fin) {
    const d = new Date();
    const days = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
    const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    const month = todayISO().slice(0, 7);
    const mCount = fin.filter(w => (w.date || '').startsWith(month)).length;
    return '<div class="card hero">' +
        '<div class="hero-date">' + days[d.getDay()] + ', ' + d.getDate() + ' ' + months[d.getMonth()] + '</div>' +
        '<p class="t1" style="font-size:21px;margin-top:4px">Готов к тренировке?</p>' +
        '<p class="muted">Всего тренировок: ' + fin.length + ' · в этом месяце: ' + mCount + '</p>' +
        '<div class="btnrow"><button class="btn prime wide" data-act="startWorkout">🏋️ Начать тренировку</button></div></div>';
}
function previewCard(w) {
    const d = parseDateISO(w.date);
    const dateStr = firstLine(w);
    const rightTop = d ? d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()] : '';
    const dp = dayPart(w);
    const exs = (w.exercises || []).filter(e => e.sets.length && !isWarmupName(e.name));
    const hasTitle = w.title && w.title.trim();
    const show = exs.slice(0, hasTitle ? 2 : 3);
    const sets = (w.exercises || []).reduce((a, e) => a + setsCount(e), 0);
    const mins = durationMin(w);
    const p = G.profile;
    const res = p && p.weight > 0 ? calcWorkoutKcal(p, w) : null;
    let h = '<div class="pcard" data-act="openHistory" data-a="' + w.id + '">';
    h += '<div class="pc-main">';
    h += '<div class="pc-daterow">' +
        '<span class="pc-date">' + (dp ? '<span class="dp-inline">' + dp.i + '</span> ' : '') + esc(dateStr) + '</span>' +
        (w.finished ? '' : '<span class="pc-pill">⚫ идёт</span>') + '</div>';
    if (hasTitle) h += '<div class="pc-title">' + esc(String(w.title).split('\n')[0].trim()) + '</div>';
    if (!show.length) h += '<div class="pc-ex">Без упражнений</div>';
    for (const e of show) h += '<div class="pc-ex">' + esc(e.name) + '</div>';
    h += '</div>';
    h += '<div class="pc-side">';
    h += '<div class="pc-dow">' + rightTop + '</div>';
    h += '<div class="pc-right">';
    if (mins != null) h += '<span>⏱ ' + durationText(mins) + '</span>';
    if (res && res.total > 0) h += '<span>🔥 ' + res.total + ' ккал</span>';
    h += '<span>🏋 ' + sets + ' подх.</span>';
    h += '</div></div></div>';
    return h;
}

/* ---------- история и карточка ---------- */
function renderHistoryTab() {
    if (viewWid) {
        const w = findW(viewWid);
        if (!w) { viewWid = 0; } else {
            return workoutCard(w, true);
        }
    }
    const fin = G.workouts.filter(w => w.finished).slice().reverse();
    const act = activeW();
    if (!fin.length && !act) return '<p class="empty">Пока нет завершённых тренировок 💪</p>';
    let h = '<div class="card" style="padding:10px">';
    if (act) h += previewCard(act);
    for (const w of fin) h += previewCard(w);
    h += '</div>';
    return h;
}
function openHistory(id) {
    editSnap = JSON.stringify(G);
    viewWid = id;
    tab = 'history';
    render();
}
function closeHistory() {
    if (isDirty()) { exitDirtyModal(); return; }
    editSnap = null;
    viewWid = 0;
    render();
}
function isDirty() { return false; }
function exitDirtyModal() {
    const h = '<p class="mtitle">Есть несохранённые изменения</p>' +
        '<div class="btnrow"><button class="btn prime wide" data-act="saveAndExit">💾 Сохранить и выйти</button>' +
        '<button class="btn sec wide" data-act="discardExit">🚪 Выйти без сохранения</button>' +
        '<button class="btn sec wide" data-act="closeModal">Отмена</button></div>';
    openModal(h);
}
async function saveAndExit() {
    closeModal();
    await save();
    editSnap = null;
    viewWid = 0;
    render();
}
async function discardExit() {
    closeModal();
    await reloadSilently(true);
    editSnap = null;
    viewWid = 0;
    render();
}

/* ---------- карточка тренировки ---------- */
function workoutCard(w, showActions) {
    showActions = showActions !== false;
    const lines = titleLines(w);
    let h = '<div class="card" id="w' + w.id + '">';
    const dpw = dayPart(w);
    h += '<div class="wchead"><div class="wctitles"><p class="t1">' +
        (dpw ? '<span class="dp-inline">' + dpw.i + '</span> ' : '') + esc(lines[0]) + '</p>';
    for (let i = 1; i < lines.length; i++) h += '<div class="tn">' + esc(lines[i]) + '</div>';
    h += '</div><div class="wcright"><div class="wcicons">' +
        '<button class="barebtn pencil-bare" data-act="titleModal" data-a="' + w.id + '" title="Название">' + ICONS.pencil + '</button>' +
        '<button class="barebtn" data-act="timeModal" data-a="' + w.id + '" title="Время">' + ICONS.timer + '</button>' +
        '<button class="barebtn trash-bare" data-act="confirmModal" data-a="Удалить тренировку?" data-b="deleteWorkout" data-c="' + w.id + '" title="Удалить">' + ICONS.trash + '</button>' +
        '</div>';
    if (w.started) {
        const sT = String(w.started).slice(11, 16);
        const range = (w.finished && w.ended) ? sT + '–' + String(w.ended).slice(11, 16) : 'с ' + sT;
        const mins = durationMin(w);
        const setsTotal = (w.exercises || []).reduce((a, e) => a + setsCount(e), 0);
        let pill = '<span class="wpill wp-r">🕐 ' + range + '</span>';
        if (mins != null) pill += '<span class="wpill wp-d">⏱ ' + durationText(mins) + '</span>';
        if (G.profile && G.profile.weight > 0) {
            const res = calcWorkoutKcal(G.profile, w);
            if (res && res.total > 0) pill += '<span class="wpill wp-k">🔥 ' + res.total + ' ккал</span>';
        }
        if (setsTotal > 0) pill += '<span class="wpill wp-s">🏋 ' + setsTotal + ' подх.</span>';
        h += '<div class="wcpill">' + pill + '</div>';
    }
    h += '</div></div>';
    if (w.nutrition && w.nutrition.trim()) h += '<p class="meta">🥤 ' + esc(w.nutrition) + '</p>';
    const exs = w.exercises || [];
    if (!exs.length) {
        h += '<p class="muted" style="margin-top:8px">Пока нет упражнений.</p>';
    }
    exs.forEach((e, ei) => {
        const c = findCatalog(e.name);
        h += '<div class="expill"><div class="exhead">' + (c ? ico(c.i) : ico('custom')) +
            '<span class="exname">' + esc(e.name) + '</span>' +
            '<button class="barebtn pencil-bare" data-act="renameExercise" data-a="' + w.id + '" data-b="' + ei + '" title="Переименовать">' + ICONS.pencil + '</button>' +
            '<button class="barebtn trash-bare" data-act="deleteExercise" data-a="' + w.id + '" data-b="' + ei + '" title="Удалить упражнение">' + ICONS.trash + '</button>' +
            '</div>';
        e.sets.forEach((s, si) => {
            h += '<div class="entry" data-act="openEntryModal" data-a="' + w.id + '" data-b="' + ei + '" data-c="' + si + '">' +
                '<span class="rectext">' + esc(entryLine(s)) + '</span>' +
                '<span class="recic">' +
                '<span class="recbtn" data-act="openEntryModal" data-a="' + w.id + '" data-b="' + ei + '" data-c="' + si + '" title="Изменить">✏️</span>' +
                '<span class="recbtn" data-act="deleteSet" data-a="' + w.id + '" data-b="' + ei + '" data-c="' + si + '" title="Удалить запись">🗑️</span>' +
                '</span></div>';
        });
        if (w.id === (CUR && CUR.wid) && e.name === (CUR && CUR.name)) {
            h += '<div class="restline"> упражнение активно — время идёт</div>';
        }
        h += '<div class="btnrow"><button class="btn sec" data-act="openEntryModal" data-a="' + w.id + '" data-b="' + ei + '" data-c="-1">➕ Запись</button></div>';
        h += '</div>';
    });
    if (G.profile && G.profile.weight > 0 && exs.length) {
        h += '<details><summary>🔥 Ккал по упражнениям</summary>' + kcalBreakdown(w) + '</details>';
    }
    h += '<details><summary>📈 Прогресс</summary>' + progressHtml(w) + '</details>';
    if (showActions) h += '<div class="btnrow">';
    if (showActions && !w.finished) {
        h += '<button class="btn prime wide icbtn" data-act="openPicker" data-a="' + w.id + '">' + ICONS.plus + '<span>Упражнение</span></button>';
        h += '<div class="split2">' +
            '<button class="btn danger icbtn" data-act="confirmModal" data-a="Отменить тренировку?" data-b="deleteWorkout" data-c="' + w.id + '">' + ICONS.cross + '<span>Отменить</span></button>' +
            '<button class="btn prime icbtn" data-act="finishWorkout" data-a="' + w.id + '">' + ICONS.check + '<span>Завершить</span></button>' +
            '</div>';
    }
    if (showActions && w.finished) {
        h += '<button class="btn danger wide icbtn" data-act="confirmModal" data-a="Удалить тренировку?" data-b="deleteWorkout" data-c="' + w.id + '">' + ICONS.trash + '<span>Удалить тренировку</span></button>';
    }
    if (showActions) h += '</div>';
    h += '</div>';
    return h;
}
function timeLine(w) {
    if (!w.started) return '⏱ время не зафиксировано';
    const start = w.started.slice(11, 16);
    const mins = durationMin(w);
    const dur = mins != null ? ' · ' + durationText(mins) : '';
    if (w.finished && w.ended) return '⏱ ' + start + '–' + w.ended.slice(11, 16) + dur;
    return '⏱ начало ' + start + dur;
}
function kcalBreakdown(w) {
    const mins = durationMin(w);
    if (mins == null) return '<p class="muted">Время начала не зафиксировано — нажми «⏱ Время».</p>';
    let h = '⏱ Длительность: ' + durationText(mins);
    h += '\n🏋️ Объём: ≈' + fmtW(Math.round(workoutVolume(w))) + ' кг';
    if (!G.profile || !(G.profile.weight > 0)) {
        h += '\n\n⚠️ Задай вес в профиле — он нужен для расчёта.';
        return '<div class="hl">' + esc(h) + '</div>';
    }
    h += '\nВес: ' + fmtW(G.profile.weight) + ' кг · формула: MET × 3.5 × вес ÷ 200 × мин\n';
    const res = calcWorkoutKcal(G.profile, w);
    for (const l of res.lines) {
        h += '\n• ' + esc(l.name) + ' — ' + (l.m != null ? l.m + ' мин, ' : '') + 'MET ' + l.met + (l.kcal != null ? ' ≈ ' + l.kcal + ' ккал' : '');
    }
    h += '\n\n🔥 Итого: ≈' + res.total + ' ккал';
    return '<div class="hl">' + esc(h) + '</div>';
}
function progressHtml(w) {
    const prev = prevOf(w);
    if (!prev) return '<p class="muted">Это первая тренировка — сравнивать не с чем.</p>';
    let h = '<p class="muted">Сравнение с ' + esc(firstLine(prev)) + '</p>';
    const d1 = durationMin(w), d0 = durationMin(prev);
    if (d1 != null && d0 != null) {
        h += '<div class="statline">⏱ ' + durationText(d0) + ' → ' + durationText(d1) + diffTxt(d1 - d0, ' мин') + '</div>';
    }
    const p = G.profile;
    if (p && p.weight > 0) {
        const k1 = calcWorkoutKcal(p, w), k0 = calcWorkoutKcal(p, prev);
        if (k0 && k1) {
            h += '<div class="statline">🔥 ' + k0.total + ' → ' + k1.total + ' ккал' + diffTxt(k1.total - k0.total, '') + '</div>';
        }
    }
    h += '<div class="statline"><b>Упражнения</b></div>';
    let any = false;
    for (const e of (w.exercises || [])) {
        if (!e.sets.length) continue;
        const pe = findEx(prev, e.name);
        if (!pe || !pe.sets.length) {
            h += '<div class="statline">• ' + esc(e.name) + ': новое упражнение</div>';
            any = true;
            continue;
        }
        const cur = maxWeightOf(e), pw = maxWeightOf(pe);
        const cs = setsCount(e), ps = setsCount(pe);
        let line = '• ' + esc(e.name) + ': ';
        if (pw > 0 || cur > 0) {
            line += fmtW(pw) + ' → ' + fmtW(cur) + ' кг' + diffTxt(Math.round(cur - pw), ' кг');
        } else {
            line += 'без веса';
        }
        if (ps !== cs) line += ', подходов ' + ps + ' → ' + cs;
        h += '<div class="statline">' + line + '</div>';
        any = true;
    }
    if (!any) h += '<p class="muted">Нет записей.</p>';
    return h;
}
function diffTxt(delta, unit) {
    if (!delta) return '';
    const up = delta > 0;
    return ' <span class="dl ' + (up ? 'dl-up' : 'dl-down') + '">' + (up ? '▲ +' : '▼ −') + Math.abs(delta) + unit + '</span>';
}
function maxWeightSeries(name) {
    const out = [];
    for (const w of G.workouts) {
        const e = findEx(w, name);
        if (e && e.sets.length) out.push(maxWeightOf(e));
    }
    return out;
}

/* ---------- техника ---------- */
function techFiltered() {
    let list = CATALOG.slice();
    if (TECH.cat) list = list.filter(c => c.t.includes(TECH.cat));
    if (TECH.q) list = list.filter(c => c.n.toLowerCase().includes(TECH.q.toLowerCase()));
    return list;
}
function techChipsHtml() {
    let h = '<div class="secrow">';
    for (const s of CAT_SECTIONS) {
        if (s.id === 'all') continue;
        h += '<button class="chip' + (TECH.section === s.id ? ' on' : '') + '" data-act="techSection" data-a="' + s.id + '">' + s.n + '</button>';
    }
    h += '</div>';
    if (TECH.section !== 'all') {
        h += '<div class="secrow">';
        for (const c of (CATS[TECH.section] || [])) {
            h += '<button class="chip' + (TECH.cat === c.id ? ' on' : '') + '" data-act="techCat" data-a="' + c.id + '">' + ico(c.icon) + ' ' + c.n + '</button>';
        }
        h += '</div>';
    }
    return h;
}
function renderTechTab() {
    if (TECH.open) {
        const c = CATALOG.find(x => x.id === TECH.open);
        if (!c) { TECH.open = null; } else {
            let h = '<div class="card"><div class="exhead">' + ico(c.i) + '<span class="t1">' + esc(c.n) + '</span><span class="metbadge">MET ' + c.met + '</span></div>';
            h += '<p class="meta">' + c.t.map(t => '#' + t).join(' ') + '</p>';
            h += '<p class="mtitle" style="margin-top:12px">Техника</p>';
            c.how.forEach((s, i) => {
                h += '<div class="techstep"><span class="num">' + (i + 1) + '.</span><span>' + esc(s) + '</span></div>';
            });
            if (c.err && c.err.length) {
                h += '<p class="mtitle" style="margin-top:12px">Частые ошибки</p>';
                for (const e of c.err) h += '<div class="techerr">✕ ' + esc(e) + '</div>';
            }
            h += '</div>';
            return h;
        }
    }
    let h = '<div class="card"><p class="t1">📖 Техника упражнений</p>' +
        '<div class="searchbox"><input id="techQ" type="text" placeholder="Поиск упражнения..." value="' + esc(TECH.q) + '"></div>' +
        techChipsHtml() + '</div>';
    h += '<div class="exgrid" id="techList">';
    for (const c of techFiltered()) {
        h += '<div class="excard" data-act="openTech" data-a="' + c.id + '">' + ico(c.i) +
            '<span><div class="exn">' + esc(c.n) + '</div><div class="extags">' + c.t.map(t => '#' + t).join(' ') + '</div></span></div>';
    }
    h += '</div>';
    if (!techFiltered().length) h += '<p class="empty">Ничего не найдено</p>';
    return h;
}

/* ---------- статистика ---------- */
function renderStatsTab() {
    const fin = G.workouts.filter(w => w.finished);
    if (!fin.length) return '<p class="empty">Нет данных. Заверши первую тренировку! 💪</p>';
    const month = todayISO().slice(0, 7);
    let monthCount = 0, totalMin = 0, totalSets = 0;
    const byEx = {};
    for (const w of fin) {
        if ((w.date || '').startsWith(month)) monthCount++;
        const m = durationMin(w);
        if (m != null) totalMin += m;
        for (const e of (w.exercises || [])) {
            totalSets += e.sets.length;
            const s = byEx[e.name] = byEx[e.name] || { sessions: 0, maxW: 0, hasW: false, last: '', lastDate: '' };
            s.sessions++;
            for (const b of e.sets) {
                const mw = maxNum(b.w);
                if (mw > s.maxW) s.maxW = mw;
                if (mw > 0) s.hasW = true;
                s.last = entryLine(b);
                s.lastDate = w.date;
            }
        }
    }
    const names = Object.keys(byEx).sort((a, b) => byEx[b].sessions - byEx[a].sessions);
    let h = '<div class="card"><p class="t1">📊 Статистика</p>' +
        '<p class="meta">Тренировок всего: ' + fin.length + '</p>' +
        '<p class="meta">В этом месяце: ' + monthCount + '</p>';
    if (totalMin > 0) h += '<p class="meta">Общее время: ' + durationText(totalMin) + '</p>';
    h += '<p class="meta">Подходов всего: ' + totalSets + '</p></div>';
    h += '<div class="card"><p class="t1">📈 Тренды</p>';
    const trendNames = names.slice(0, 5);
    for (const name of trendNames) {
        const series = maxWeightSeries(name);
        h += '<div class="trendline"><span style="flex:1;min-width:0"><b>' + esc(name) + '</b><br><span class="tn">' +
            fmtW(series[series.length - 1] || 0) + ' кг — последний результат</span></span></div>';
    }
    if (!trendNames.length) h += '<p class="muted">Нет данных</p>';
    h += '</div><div class="card"><p class="t1">🏆 Упражнения</p>';
    for (const name of names.slice(0, 15)) {
        const s = byEx[name];
        h += '<div class="statline"><b>' + esc(name) + '</b> (' + s.sessions + ' раз.)</div>' +
            '<div class="tn">Максимум: ' + (s.hasW ? fmtW(s.maxW) + ' кг' : 'без веса') + '</div>' +
            '<div class="tn">Последний: ' + esc(s.last) + (s.lastDate ? ' (' + esc(s.lastDate.split('-').reverse().slice(0, 2).join('-')) + ')' : '') + '</div>';
    }
    h += '</div>';
    return h;
}

/* ---------- тренер ---------- */
function renderCoachTab() {
    return '<div class="card hero"><p class="t1">🧑‍🏫 Персональный тренер</p>' +
        '<p class="muted">Раздел в разработке: здесь появятся персональные программы тренировок, разборы техники и советы по питанию.</p>' +
        '<p class="meta">Следи за обновлениями 💪</p></div>';
}

/* ---------- профиль ---------- */
function renderProfileTab() {
    if (!profileSex && G.profile) profileSex = G.profile.sex;
    const p = G.profile || { sex: profileSex, age: '', height: '', weight: '' };
    let h = '<div class="card"><p class="t1">⚙️ Профиль</p>';
    if (G.profile) {
        h += '<p class="meta">' + esc(G.profile.sex.toUpperCase()) + ' · ' + G.profile.age + ' лет · ' +
            G.profile.height + ' см · ' + fmtW(G.profile.weight) + ' кг</p>' +
            '<p class="meta">BMR ≈ ' + Math.round(bmr(G.profile)) + ' ккал/сут (Mifflin-St Jeor)</p>';
    } else {
        h += '<p class="meta">Нужен для расчёта калорий 🔥</p>';
    }
    h += '</div>';
    h += '<div class="card"><p class="t1">Пол</p>' +
        '<div class="sexbtns">' +
        '<button class="btn' + (profileSex === 'м' ? '' : ' sec') + '" data-act="setSex" data-a="м">Мужской</button>' +
        '<button class="btn' + (profileSex === 'ж' ? '' : ' sec') + '" data-act="setSex" data-a="ж">Женский</button>' +
        '</div></div>';
    h += '<div class="card">' +
        '<label>Возраст</label><input id="pfAge" type="number" inputmode="numeric" value="' + p.age + '">' +
        '<label>Рост (см)</label><input id="pfHeight" type="number" inputmode="numeric" value="' + p.height + '">' +
        '<label>Вес (кг)</label><input id="pfWeight" type="number" inputmode="decimal" step="0.1" value="' + p.weight + '">' +
        '<div class="btnrow"><button class="btn wide" data-act="saveProfile">💾 Сохранить профиль</button></div></div>';
    h += '<div class="card"><p class="t1">🎨 Тема оформления</p><div class="themegrid">';
    const cur = document.documentElement.getAttribute('data-theme') || 'sage';
    for (const t of THEMES) {
        h += '<div class="themecard' + (cur === t.id ? ' on' : '') + '" data-act="setTheme" data-a="' + t.id + '">' +
            '<span class="themedots">' + t.dots.map(c => '<i style="background:' + c + '"></i>').join('') + '</span>' +
            '<span style="font-size:13px">' + t.name + '</span></div>';
    }
    h += '</div></div>';
    h += '<div class="card"><p class="t1">🖼 Фон приложения</p>' +
        '<p class="meta">Картинка хранится только на этом устройстве</p>' +
        '<div class="split2">' +
        '<button class="btn sec" data-act="pickBg">📷 Выбрать из галереи</button>' +
        '<button class="btn sec" data-act="clearBg">Убрать фон</button>' +
        '</div></div>';
    return h;
}
function saveProfile() {
    const sex = profileSex || 'м';
    const age = parseInt(document.getElementById('pfAge').value, 10);
    const height = parseInt(document.getElementById('pfHeight').value, 10);
    const weight = parseFloat(String(document.getElementById('pfWeight').value).replace(',', '.'));
    if (!(age >= 10 && age <= 100) || !(height >= 100 && height <= 250) || !(weight >= 30 && weight <= 300)) {
        toast('Проверь значения: возраст 10–100, рост 100–250, вес 30–300', true);
        return;
    }
    G.profile = { sex, age, height, weight };
    save().then(function (r) { if (r === 'ok') toast('✓ Профиль сохранён'); render(); });
}

/* ---------- действия тренировки ---------- */
function startWorkout() {
    const active = activeW();
    if (active) { openPicker(active.id); return; }
    const w = { id: G.nextId++, date: todayISO(), started: nowLocalISO(), ended: '', finished: false, title: '', nutrition: '', exercises: [] };
    if (G.nextId < 1) G.nextId = 1;
    G.workouts.push(w);
    save().then(function (r) {
        if (r !== 'ok') toast('Нет связи: тренировка сохранится при следующей записи', true);
        render();
        openPicker(w.id);
    });
}
function finishWorkout(id) {
    const w = findW(id);
    if (!w) return;
    closeCurrentExercise();
    for (const e of w.exercises) {
        if (e.st && !e.en) e.en = nowLocalISO();
    }
    w.exercises = (w.exercises || []).filter(e => e.sets.length);
    if (!w.exercises.length) { toast('Сначала добавь хотя бы одно упражнение 💪', true); return; }
    w.finished = true;
    if (!w.ended) w.ended = nowLocalISO();
    save().then(function (r) { if (r === 'ok') toast('✅ Тренировка завершена'); render(); });
}
function deleteWorkout(id) {
    if (!G.del) G.del = [];
    G.del.push(id);
    G.workouts = G.workouts.filter(w => w.id !== id);
    if (viewWid === id) viewWid = 0;
    save().then(render);
}

/* ---------- пикер ---------- */
function openPicker(wid) {
    PICKER = { wid, section: 'all', cat: null, q: '' };
    renderPickerModal();
}
function favsList() {
    try { return JSON.parse(localStorage.getItem('gymFavs') || '[]'); } catch (e) { return []; }
}
function isFav(n) { return favsList().includes(n); }
function toggleFav(n) {
    let f = favsList();
    if (f.includes(n)) f = f.filter(x => x !== n); else f.push(n);
    try { localStorage.setItem('gymFavs', JSON.stringify(f)); } catch (e) { /* noop */ }
    renderPickerList();
}
function mostUsed(n) {
    const cnt = {};
    for (const w of G.workouts) {
        for (const e of (w.exercises || [])) {
            if (e.sets.length) cnt[e.name] = (cnt[e.name] || 0) + e.sets.length;
        }
    }
    return Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]).slice(0, n);
}
function ownCustomNames() {
    const set = new Set(customBase());
    for (const w of G.workouts) {
        for (const e of (w.exercises || [])) {
            if (isCustomEx(e.name)) set.add(e.name);
        }
    }
    return Array.from(set);
}
function customBase() {
    try { return JSON.parse(localStorage.getItem('gymCustomEx') || '[]'); } catch (e) { return []; }
}
function addCustomBase(n) {
    const a = customBase();
    if (a.includes(n)) return;
    a.push(n);
    try { localStorage.setItem('gymCustomEx', JSON.stringify(a)); } catch (e) { /* noop */ }
}
function exCard(c) {
    return '<div class="excard" data-act="pickCatEx" data-a="' + esc(c.n) + '">' + ico(c.i) +
        '<span style="flex:1;min-width:0"><div class="exn">' + esc(c.n) + '</div>' +
        '<div class="extags">' + c.t.slice(0, 3).map(t => '#' + t).join(' ') + '</div></span>' + starHtml(c.n) + '</div>';
}
function exCardByName(name) {
    const c = findCatalog(name);
    const tags = c ? c.t.slice(0, 3).map(t => '#' + t).join(' ') : '#своё';
    return '<div class="excard" data-act="pickCatEx" data-a="' + esc(name) + '">' + (c ? ico(c.i) : ico('custom')) +
        '<span style="flex:1;min-width:0"><div class="exn">' + esc(name) + '</div><div class="extags">' + tags + '</div></span>' + starHtml(name) + '</div>';
}
function starHtml(name) {
    return '<span class="star' + (isFav(name) ? ' fav' : '') + '" data-fav="' + esc(name) + '">' + (isFav(name) ? '★' : '☆') + '</span>';
}
function pickerChipsHtml() {
    let h = '';
    for (const s of CAT_SECTIONS) {
        h += '<button class="chip' + (PICKER.section === s.id ? ' on' : '') + '" data-act="pickerSection" data-a="' + s.id + '">' + s.n + '</button>';
    }
    return h;
}
function pickerCatsHtml() {
    let h = '';
    for (const c of (CATS[PICKER.section] || [])) {
        h += '<button class="chip' + (PICKER.cat === c.id ? ' on' : '') + '" data-act="pickerCat" data-a="' + c.id + '">' + ico(c.icon) + ' ' + c.n + '</button>';
    }
    return h;
}
function renderPickerChips() {
    const sec = document.getElementById('pickerSections');
    if (sec) sec.innerHTML = pickerChipsHtml();
    const catsBox = document.getElementById('pickerCats');
    if (!catsBox) return;
    const showCats = PICKER.section !== 'fav' && PICKER.section !== 'all';
    catsBox.style.display = showCats ? '' : 'none';
    if (showCats) catsBox.innerHTML = pickerCatsHtml();
}
function renderPickerList() {
    const box = document.getElementById('pickerList');
    if (!box) return;
    console.log('[picker] section=' + PICKER.section + ' cat=' + PICKER.cat + ' q=' + (PICKER.q || ''));
    const q = (PICKER.q || '').toLowerCase();
    let h = '';
    if (PICKER.section === 'fav') {
        const favs = favsList().filter(n => !q || n.toLowerCase().includes(q));
        let list;
        if (favs.length) {
            list = CATALOG.filter(c => favs.includes(c.n));
            h += '<div class="muted" style="margin:6px 0">★ Избранные</div>';
            h += '<div class="exgrid">';
            for (const c of list) h += exCard(c);
            h += '</div>';
        } else {
            h += '<p class="empty">★ Избранных пока нет — отмечай ☆ на карточках упражнений</p>';
        }
    } else if (PICKER.section === 'coll' && PICKER.cat === 'own') {
        const own = ownCustomNames().filter(n => !q || n.toLowerCase().includes(q));
        for (const n of own) h += exCardByName(n);
        if (!own.length) h += '<p class="empty">Своих упражнений пока нет</p>';
    } else {
        let list = CATALOG.slice();
        if (PICKER.cat) list = list.filter(c => c.t.includes(PICKER.cat));
        if (q) list = list.filter(c => c.n.toLowerCase().includes(q));
        let customs = [];
        if (!PICKER.cat && PICKER.section !== 'coll') {
            customs = customBase().filter(n => !q || n.toLowerCase().includes(q));
        }
        h += '<div class="exgrid">';
        for (const c of list) h += exCard(c);
        for (const n of customs) h += exCardByName(n);
        h += '</div>';
        if (!list.length && !customs.length) h += '<p class="empty">Ничего не найдено</p>';
    }
    box.innerHTML = h;
}
function renderPickerModal() {
    let h = '<p class="mtitle">➕ Добавить упражнение</p>';
    h += '<div class="searchbox"><input id="pickerQ" type="text" placeholder="Поиск..." autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(PICKER.q) + '"></div>';
    const showCats = PICKER.section !== 'fav' && PICKER.section !== 'all';
    h += '<div class="secrow" id="pickerSections">' + pickerChipsHtml() + '</div>';
    h += '<div class="secrow" id="pickerCats"' + (showCats ? '' : ' style="display:none"') + '>' + (showCats ? pickerCatsHtml() : '') + '</div>';
    h += '<div class="excard" data-act="customExerciseModal" style="margin:6px 0">' + ico('custom') +
        '<span><div class="exn">✍️ Своё упражнение</div><div class="extags">добавь то, чего нет в каталоге</div></span></div>';
    h += '<div id="pickerList"></div>';
    h += '<div class="btnrow"><button class="btn sec wide" data-act="closeModal">Закрыть</button></div>';
    openModal(h);
    const q = document.getElementById('pickerQ');
    if (q) q.addEventListener('input', function () { PICKER.q = this.value; renderPickerList(); });
    renderPickerList();
}
function pickCatEx(name) {
    const w = findW(PICKER.wid);
    if (!w) return closeModal();
    closeCurrentExercise();
    const e = startExercise(w, name);
    storage_after_pick(w, e);
}
function storage_after_pick(w, e) {
    save();
    closeModal();
    SUG_W = lastWeights(e.name);
    SUG_R = lastReps(e.name);
    const pop = popularWeight(e.name);
    if (pop && !SUG_W.includes(pop)) SUG_W.push(pop);
    openEntryModalIdx(w, w.exercises.indexOf(e), -1);
}
function customExerciseModal() {
    const w = findW(PICKER.wid);
    const h = '<p class="mtitle">✍️ Своё упражнение</p>' +
        '<label>Название (до 60 символов)</label><input id="mCustomName" type="text" maxlength="60">' +
        '<div class="btnrow"><button class="btn wide" data-act="createCustom">➕ Добавить</button>' +
        '<button class="btn sec wide" data-act="closeModal">Отмена</button></div>';
    openModal(h);
    const inp = document.getElementById('mCustomName');
    if (inp) inp.focus();
    void w;
}
function createCustom() {
    const w = findW(PICKER.wid);
    const name = String((document.getElementById('mCustomName') || {}).value || '').trim();
    if (!name || name.length > 60) { toast('Название от 1 до 60 символов', true); return; }
    addCustomBase(name);
    closeCurrentExercise();
    const e = startExercise(w, name);
    save();
    SUG_W = lastWeights(name);
    SUG_R = lastReps(name);
    closeModal();
    openEntryModalIdx(w, w.exercises.indexOf(e), -1);
}

/* ---------- окно записи ---------- */
function openEntryModal(wid, exIdx, setIdx) {
    const w = findW(wid);
    if (!w || !w.exercises[exIdx]) return;
    openEntryModalIdx(w, exIdx, setIdx);
}
function openEntryModalIdx(w, exIdx, setIdx) {
    const e = w.exercises[exIdx];
    const isNew = setIdx < 0;
    const s = isNew ? { w: '', s: 1, r: '' } : e.sets[setIdx];
    modalCtx = { wid: w.id, exIdx, setIdx, name: e.name };
    let h = '<p class="mtitle">' + (isNew ? 'Новая запись' : 'Изменить запись') + '</p>' +
        '<p class="muted">' + esc(e.name) + '</p>' +
        '<label>Вес, кг (можно «50, 80» или «100-260», пусто — без веса)</label>' +
        '<input id="mWeight" type="text" value="' + esc(s.w) + '">' +
        '<div class="keypad">' +
        ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '.', '-'].map(function (k) {
            return '<button class="kp" data-act="kpIns" data-a="' + k + '">' + (k === '-' ? '–' : k) + '</button>';
        }).join('') +
        '<button class="kp kp-del" data-act="kpDel">⌫</button>' +
        '</div>';
    if (isNew && SUG_W.length) {
        h += '<div class="chips">';
        SUG_W.forEach((v, i) => { h += '<button class="chip" data-act="chipW" data-a="' + i + '">' + esc(v) + ' кг</button>'; });
        h += '<button class="chip" data-act="chipW" data-a="-1">🚫 Без веса</button></div>';
    }
    h += '<label>Подходы</label><input id="mSets" type="number" inputmode="numeric" value="' + (+s.s || 1) + '">' +
        '<label>Повторения (12, 8-10, макс, 5+1)</label>' +
        '<input id="mReps" type="text" value="' + esc(s.r) + '">';
    if (isNew && SUG_R.length) {
        h += '<div class="chips">';
        SUG_R.forEach((v, i) => { h += '<button class="chip" data-act="chipR" data-a="' + i + '">' + esc(v) + '</button>'; });
        h += '</div>';
    }
    h += '<div class="btnrow"><button class="btn wide" data-act="saveEntry">' + (isNew ? '➕ Добавить' : '💾 Сохранить') + '</button>';
    if (!isNew) h += '<button class="btn danger wide" data-act="deleteEntry">🗑 Удалить запись</button>';
    h += '<button class="btn sec wide" data-act="closeModal">Закрыть</button></div>';
    openModal(h);
    /* при фокусе поле выделяется целиком — ввод с клавиатуры заменяет значение, а не дописывает */
    ['mWeight', 'mSets', 'mReps'].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('focus', function () { try { el.select(); } catch (err) { /* noop */ } });
    });
}
function chipW(i) {
    document.getElementById('mWeight').value = i < 0 ? '' : SUG_W[i];
}
function chipR(i) {
    document.getElementById('mReps').value = SUG_R[i];
}
function kpIns(ch) {
    const inp = document.getElementById('mWeight');
    if (inp) inp.value = (inp.value || '') + ch;
}
function kpDel() {
    const inp = document.getElementById('mWeight');
    if (inp && inp.value.length) inp.value = inp.value.slice(0, -1);
}
async function saveEntry() {
    if (!modalCtx) return;
    const wid = modalCtx.wid, setIdx = modalCtx.setIdx, name = modalCtx.name;
    let weight = String(document.getElementById('mWeight').value).trim().replace(/[.,;]+$/, '');
    if (weight.toLowerCase().endsWith('кг')) weight = weight.slice(0, -2).trim();
    weight = weight.replace(/[.,;]+$/, '').trim();
    const sets = parseInt(document.getElementById('mSets').value, 10);
    const reps = String(document.getElementById('mReps').value).trim();
    if (weight.length > 25 || !/^[\d.,\-\s]*$/.test(weight) || (weight && !/\d/.test(weight))) {
        toast('Некорректный вес. Например: 45 или 50, 80', true);
        return;
    }
    if (!(sets >= 1 && sets <= 30)) { toast('Подходы: число от 1 до 30', true); return; }
    if (!reps || reps.length > 15) { toast('Повторения: например 12, 8-10 или макс', true); return; }
    await reloadSilently();
    const w = findW(wid);
    const e = w ? findEx(w, name) : null;
    if (!e) {
        toast('Упражнение не найдено — запись не сохранена', true);
        closeModal();
        render();
        return;
    }
    if (setIdx < 0) {
        e.sets.push({ w: weight, s: sets, r: reps, t: nowLocalISO() });
    } else {
        const old = e.sets[setIdx];
        e.sets[setIdx] = { w: weight, s: sets, r: reps, t: old ? (old.t || nowLocalISO()) : nowLocalISO() };
    }
    await save();
    if (modalCtx) toast('✓ Сохранено');
    closeModal();
    render();
}
async function deleteEntry() {
    if (!modalCtx) return;
    const wid = modalCtx.wid, setIdx = modalCtx.setIdx, name = modalCtx.name;
    await reloadSilently();
    const w = findW(wid);
    const e = w ? findEx(w, name) : null;
    if (!e) { closeModal(); render(); return; }
    if (setIdx < e.sets.length) e.sets.splice(setIdx, 1);
    if (!e.sets.length) w.exercises.splice(w.exercises.indexOf(e), 1);
    await save();
    closeModal();
    render();
}

/* ---------- переименование/удаление упражнения ---------- */
function renameExercise(wid, exIdx) {
    const w = findW(wid);
    if (!w || !w.exercises[exIdx]) return;
    modalCtx = { wid, exIdx, setIdx: -1, name: w.exercises[exIdx].name };
    renameModalHtml(w);
}
function renameModalHtml(w) {
    const e = w.exercises[modalCtx.exIdx];
    const h = '<p class="mtitle">Переименовать упражнение</p>' +
        '<label>Название (до 60 символов)</label><input id="mName" type="text" value="' + esc(e.name) + '">' +
        '<div class="btnrow"><button class="btn wide" data-act="doRename">💾 Сохранить</button>' +
        '<button class="btn sec wide" data-act="closeModal">Отмена</button></div>';
    openModal(h);
}
async function doRename() {
    if (!modalCtx) return;
    const wid = modalCtx.wid, name2 = modalCtx.name;
    const name = String(document.getElementById('mName').value).trim();
    if (!name || name.length > 60) { toast('Название от 1 до 60 символов', true); return; }
    await reloadSilently();
    const w = findW(wid);
    const e = w ? findEx(w, name2) : null;
    if (!e) {
        toast('Упражнение не найдено — переименование не сохранено', true);
        closeModal();
        render();
        return;
    }
    const other = w.exercises.find(x => x !== e && x.name.toLowerCase() === name.toLowerCase());
    if (other) {
        other.sets.push(...e.sets);
        w.exercises.splice(w.exercises.indexOf(e), 1);
    } else {
        e.name = name;
    }
    await save();
    closeModal();
    render();
}
function deleteExercise(wid, exIdx) {
    const w = findW(wid);
    if (!w || !w.exercises[exIdx]) return;
    __delExerciseCtx = { wid, exIdx };
    confirmModal('Удалить упражнение «' + w.exercises[exIdx].name + '» со всеми записями?', 'deleteExerciseGo', null);
}
async function deleteExerciseGo() {
    await reloadSilently();
    const w = findW(__delExerciseCtx.wid);
    if (w && w.exercises[__delExerciseCtx.exIdx]) {
        w.exercises.splice(__delExerciseCtx.exIdx, 1);
        await save();
    }
    __delExerciseCtx = null;
    closeModal();
    render();
}

/* ---------- удаление записи ---------- */
function deleteSet(wid, exIdx, setIdx) {
    const w = findW(wid);
    if (!w || !w.exercises[exIdx] || !w.exercises[exIdx].sets[setIdx]) return;
    __delSetCtx = { wid, exIdx, setIdx };
    confirmModal('Удалить запись «' + entryLine(w.exercises[exIdx].sets[setIdx]) + '»?', 'deleteSetGo', null);
}
async function deleteSetGo() {
    await reloadSilently();
    const w = findW(__delSetCtx.wid);
    const e = w ? w.exercises[__delSetCtx.exIdx] : null;
    if (e && __delSetCtx.setIdx < e.sets.length) {
        e.sets.splice(__delSetCtx.setIdx, 1);
        if (!e.sets.length) w.exercises.splice(w.exercises.indexOf(e), 1);
        await save();
    }
    __delSetCtx = null;
    closeModal();
    render();
}

/* ---------- питание / название / время ---------- */
function nutrModal(wid) {
    const w = findW(wid);
    const h = '<p class="mtitle">🥤 Питание во время тренировки</p>' +
        '<label>Что пил и что ел</label>' +
        '<textarea id="mNutr" maxlength="500">' + esc(w.nutrition || '') + '</textarea>' +
        '<div class="btnrow"><button class="btn wide" data-act="saveNutr" data-a="' + wid + '">💾 Сохранить</button>' +
        '<button class="btn sec wide" data-act="clearNutr" data-a="' + wid + '">🚫 Очистить</button></div>';
    openModal(h);
}
function saveNutr(wid) {
    const w = findW(wid);
    const v = String(document.getElementById('mNutr').value).trim();
    if (v.length > 500) { toast('До 500 символов', true); return; }
    w.nutrition = v || null;
    save().then(function (r) { if (r === 'ok') toast('✓ Сохранено'); closeModal(); render(); });
}
function clearNutr(wid) {
    const w = findW(wid);
    w.nutrition = null;
    save().then(() => { closeModal(); render(); });
}
function titleModal(wid) {
    const w = findW(wid);
    const cur = w.title && w.title.trim() ? w.title : '';
    const h = '<p class="mtitle">🏷 Название тренировки</p>' +
        '<p class="muted">Сейчас: ' + esc(titleLines(w).join(' / ')) + '</p>' +
        '<label>Напиши своё название тренировки</label>' +
        '<textarea id="mTitle" maxlength="200" placeholder="Например: Спина и грудь"></textarea>' +
        '<div class="btnrow"><button class="btn wide" data-act="saveTitle" data-a="' + wid + '">💾 Сохранить</button></div>';
    openModal(h);
}
function saveTitle(wid) {
    const w = findW(wid);
    let v = String(document.getElementById('mTitle').value).trim();
    if (v.length > 200) { toast('До 200 символов', true); return; }
    if (v.toLowerCase() === 'авто') v = '';
    w.title = v || null;
    save().then(function (r) { if (r === 'ok') toast('✓ Сохранено'); closeModal(); render(); });
}
function autoTitle(wid) {
    const w = findW(wid);
    w.title = null;
    save().then(() => { closeModal(); render(); });
}
function timeModal(wid) {
    const w = findW(wid);
    const sd = isoToDateInput(w.started || w.date);
    const st = w.started ? w.started.slice(11, 16) : '';
    const ed = isoToDateInput(w.ended);
    const et = w.ended ? w.ended.slice(11, 16) : '';
    const h = '<p class="mtitle">⏱ Даты и время тренировки</p>' +
        '<label>Начало — дата (ДД.ММ.ГГГГ)</label><input id="mStartDate" type="text" inputmode="numeric" placeholder="29.10.2026" value="' + esc(sd) + '">' +
        '<label>Начало — время (ЧЧ:ММ)</label><input id="mStartTime" type="text" inputmode="numeric" placeholder="18:30" value="' + esc(st) + '">' +
        '<label>Окончание — дата</label><input id="mEndDate" type="text" inputmode="numeric" placeholder="29.10.2026" value="' + esc(ed) + '">' +
        '<label>Окончание — время</label><input id="mEndTime" type="text" inputmode="numeric" placeholder="20:05" value="' + esc(et) + '">' +
        '<p class="muted">У активной тренировки окончание можно оставить пустым.</p>' +
        '<div id="mTimeErr" class="formerr"></div>' +
        '<div class="btnrow"><button class="btn wide" data-act="saveTime" data-a="' + wid + '">💾 Сохранить</button></div>';
    openModal(h);
    ['mStartDate', 'mEndDate'].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', function () { maskDate(this); });
    });
    ['mStartTime', 'mEndTime'].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', function () { maskTime(this); });
    });
}
function parseDateInput(s) {
    s = String(s || '').trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return s;
    m = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/.exec(s);
    if (m) return m[3] + '-' + pad2(+m[2]) + '-' + pad2(+m[1]);
    m = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2})$/.exec(s);
    if (m) return '20' + m[3] + '-' + pad2(+m[2]) + '-' + pad2(+m[1]);
    return null;
}
function parseTimeInput(s) {
    s = String(s || '').trim().replace('.', ':').replace(',', ':');
    const m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (!m) return null;
    if (+m[1] > 23 || +m[2] > 59) return null;
    return pad2(+m[1]) + ':' + m[2];
}
function isoToDateInput(iso) {
    const d = iso ? String(iso).slice(0, 10) : '';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    return m ? m[3] + '.' + m[2] + '.' + m[1] : d;
}
function maskDate(el) {
    const v = el.value.replace(/\D/g, '').slice(0, 8);
    let out = v.slice(0, 2);
    if (v.length >= 3) out += '.' + v.slice(2, 4);
    if (v.length >= 5) out += '.' + v.slice(4, 8);
    el.value = out;
}
function maskTime(el) {
    const v = el.value.replace(/\D/g, '').slice(0, 4);
    el.value = v.length >= 3 ? v.slice(0, 2) + ':' + v.slice(2) : v;
}
async function saveTime(wid) {
    const errEl = document.getElementById('mTimeErr');
    const err = function (msg) { if (errEl) errEl.textContent = msg; };
    const w = findW(wid);
    if (!w) return;
    const sdt = parseDateInput(document.getElementById('mStartDate').value);
    const stm = parseTimeInput(document.getElementById('mStartTime').value);
    if (!sdt || !stm) { err('Проверь дату и время начала (например 29.10.2026 и 18:30)'); return; }
    const rawEd = String(document.getElementById('mEndDate').value).trim();
    const rawEt = String(document.getElementById('mEndTime').value).trim();
    let endVal = null;
    if (rawEd || rawEt) {
        const edt = parseDateInput(rawEd) || sdt;
        const etm = parseTimeInput(rawEt);
        if (!etm) { err('Проверь время окончания (например 20:05) или очисти оба поля'); return; }
        endVal = edt + 'T' + etm + ':00';
    }
    const startVal = sdt + 'T' + stm + ':00';
    if (endVal && new Date(endVal) < new Date(startVal)) { err('Окончание не может быть раньше начала'); return; }
    err('');
    await reloadSilently();
    const w2 = findW(wid);
    if (!w2) { err('Тренировка не найдена'); return; }
    w2.started = startVal;
    w2.date = sdt;
    if (endVal) w2.ended = endVal;
    else if (!w2.finished) w2.ended = '';
    await save();
    if (!errEl || !errEl.textContent) toast('✓ Сохранено');
    closeModal();
    render();
}

/* ---------- подтверждения и модалки ---------- */
function confirmModal(text, fn, id) {
    PENDING = { fn, id };
    const h = '<p class="mtitle">' + esc(text) + '</p>' +
        '<div class="btnrow"><button class="btn danger wide" data-act="confirmYes">Да</button>' +
        '<button class="btn sec wide" data-act="closeModal">Отмена</button></div>';
    openModal(h);
}
function confirmYes() {
    const p = PENDING;
    closeModal();
    if (p && typeof ACTIONS[p.fn] === 'function') ACTIONS[p.fn](p.id);
}
function openModal(html) {
    const m = document.getElementById('modal');
    const mb = document.getElementById('modalBox');
    mb.innerHTML = html;
    m.classList.remove('hidden');
    m.classList.add('open');
    mb.scrollTop = 0;
}
function closeModal() {
    const m = document.getElementById('modal');
    m.classList.remove('open');
    m.classList.add('hidden');
    modalCtx = null;
}

function applyBg(data) {
    document.documentElement.classList.add('has-bg');
    document.body.style.setProperty('--bg-img', 'url("' + data + '")');
}
function loadBg() {
    let bg = null;
    try { bg = localStorage.getItem('gymBg'); } catch (e) { /* noop */ }
    if (bg) applyBg(bg);
}
function initBgPicker() {
    const bf = document.getElementById('bgFile');
    if (!bf || bf.__gymBound) return;
    bf.__gymBound = true;
    bf.addEventListener('change', function () {
        const f = this.files && this.files[0];
        if (!f) return;
        const fr = new FileReader();
        fr.onload = function () {
            const img = new Image();
            img.onload = function () {
                const max = 1280;
                const k = Math.min(1, max / Math.max(img.width, img.height));
                const cv = document.createElement('canvas');
                cv.width = Math.max(1, Math.round(img.width * k));
                cv.height = Math.max(1, Math.round(img.height * k));
                try { cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); } catch (e1) { toast('Не удалось обработать картинку', true); return; }
                let data;
                try { data = cv.toDataURL('image/jpeg', 0.82); } catch (e2) { toast('Не удалось обработать картинку', true); return; }
                try { localStorage.setItem('gymBg', data); } catch (e3) { toast('Картинка слишком большая, выбери другую', true); return; }
                applyBg(data);
                toast('✓ Фон установлен');
            };
            img.onerror = function () { toast('Не удалось открыть картинку', true); };
            img.src = fr.result;
        };
        fr.readAsDataURL(f);
        this.value = '';
    });
}

/* ---------- init ---------- */
async function init() {
    loadTheme();
    loadBg();
    initBgPicker();
    if (tg) {
        try { tg.ready(); tg.expand(); } catch (e) { /* noop */ }
        INIT = tg.initData || '';
    }
    let usedFallback = false;
    if (!INIT && location.hash) {
        const sources = [location.hash.slice(1), location.search.slice(1)];
        for (const src of sources) {
            if (!src || INIT) continue;
            const variants = [src];
            try { variants.push(decodeURIComponent(src)); } catch (e4) { /* noop */ }
            for (const v of variants) {
                const m = /tgWebAppData=([^&#]+)/.exec(v);
                if (m && m[1]) {
                    let val = m[1];
                    try { if (val.indexOf('%') >= 0) val = decodeURIComponent(val); } catch (e6) { /* noop */ }
                    INIT = val;
                    usedFallback = true;
                    break;
                }
            }
        }
    }
    let failMsg = '';
    try {
        const r = await fetch('/api/init', {
            method: 'POST',
            body: JSON.stringify({ initData: INIT })
        });
        let j = {};
        try { j = await r.json(); } catch (e2) { /* noop */ }
        if (j.ok) {
            G = j.data;
            if (!G.workouts) G.workouts = [];
            if (!G.del) G.del = [];
            if (G.nextId < 1) G.nextId = 1;
            /* id из tombstone-списка нельзя выдавать заново — иначе новая тренировка мгновенно «удалится» */
            for (const d of G.del) if (d >= G.nextId) G.nextId = d + 1;
            /* и не должен совпадать с живыми тренировками сервера */
            for (const w of G.workouts) if (w.id >= G.nextId) G.nextId = w.id + 1;
            if (G.profile) profileSex = G.profile.sex;
            render();
        } else {
            failMsg = 'HTTP ' + r.status;
        }
    } catch (e) {
        failMsg = (e && e.message) ? e.message : 'ошибка сети';
    }
    if (failMsg) {
        const info = 'tg: ' + (tg ? 'да' : 'нет')
            + ' · initData: ' + (INIT ? INIT.length + ' симв.' : 'пусто')
            + ' · платформа: ' + (tg && tg.platform ? tg.platform : '?')
            + ' · ' + failMsg;
        document.getElementById('app').innerHTML =
            '<p class="empty">Не удалось авторизоваться 😕<br>' + esc(info) +
            '<br><br>Открой приложение через меню бота (кнопка ☰ → «🏋️ Дневник»).</p>';
    }
}
window.addEventListener('scroll', function () {
    const nv = document.querySelector('.nav');
    if (nv) nv.classList.toggle('min', (window.scrollY || 0) > 60);
}, { passive: true });
init();

/* ============ тестовый крюк (используется tests/render-smoke.js) ============ */
if (typeof globalThis !== 'undefined' && globalThis.__gymExpose) {
    globalThis.__gymExpose({
        render: function (t) { if (t) { tab = t; } render(); },
        setTab: function (t) { tab = t; }
    });
}
