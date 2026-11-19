'use strict';
/* Тестовый сервер: отдаёт web/ и заглушку API (без проверки Telegram-подписи). Порт 8099. */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'web');
function initialStore() {
    return {
        nextId: 5,
        rev: 1,
        del: [],
        profile: { sex: 'м', age: 30, height: 180, weight: 90 },
        workouts: [],
        templates: [],
        goals: [] /* [GOA-S1] серверный протокол: ключ «ex» (§10.1) — мок хранит как пришло */
    };
}
let store = initialStore();
/* [ANA-T5] собранные события онбординга (прод: Stats.inc; здесь список для e2e-проверок) */
let trackedEvents = [];

const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png'
};

function sendJson(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
}

/* [UX-I16] хелперы мок-страницы /w/<shareId> */
function newShareId() {
    const abc = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const bytes = crypto.randomBytes(22);
    let s = '';
    for (let i = 0; i < 22; i++) s += abc[bytes[i] % abc.length];
    return s;
}
function escHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function shareDate(iso) {
    const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? (+m[3]) + ' ' + MONTHS[+m[2] - 1] : String(iso || '');
}
function shareWorkoutHtml(store, w) {
    let vol = 0, reps = 0;
    for (const e of (w.exercises || [])) for (const s of (e.sets || [])) {
        vol += (parseFloat(String(s.w).replace(',', '.')) || 0) * (+s.s || 0) * 8;
        reps += (+s.s || 0) * 8;
    }
    const hero = vol > 0 ? vol : reps;
    const title = 'Тренировка · ' + shareDate(w.date) + (store.shareName && store.shareOwner ? ' · ' + store.shareOwner : '');
    let exHtml = '';
    for (const e of (w.exercises || [])) {
        exHtml += '<div class="expill"><div class="exhead"><span class="ic">🏋️</span><span class="en">' + escHtml(e.name) + '</span></div>';
        for (const s of (e.sets || [])) {
            const wt = parseFloat(String(s.w).replace(',', '.')) || 0;
            exHtml += '<div class="entry"><span class="rt">' + (wt > 0 ? escHtml(s.w) + ' кг × ' : '') + (+s.s || 0) + '×' + escHtml(s.r) + '</span></div>';
        }
        exHtml += '</div>';
    }
    return '<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
        '<meta name="robots" content="noindex, nofollow">\n<title>' + escHtml(title) + '</title>\n' +
        '<meta property="og:title" content="' + escHtml(title) + '">\n' +
        '<meta property="og:description" content="Открытая карточка тренировки — GymHelper, дневник тренировок в Telegram">\n' +
        '<meta property="og:site_name" content="GymHelper">\n</head>\n<body>\n' +
        '<div class="wp"><div class="wp-brand"><b>GymHelper</b><span class="ro">👁 только просмотр</span></div>' +
        '<div class="wp-body"><div class="glass glow"><p class="wdate">' + escHtml(shareDate(w.date)) + '</p>' +
        '<div class="hero-num">' + hero + '</div></div>' +
        '<div class="glass">' + exHtml + '</div>' +
        '<p class="privline">🔒 Карточка видна только по этой ссылке — без входа и без имени.</p>' +
        '</div><div class="cta"><a class="btn" href="https://t.me/GymHelper_bot/app">🏋️ Попробовать в Telegram</a></div>' +
        '</div>\n</body>\n</html>';
}
function share404Html() {
    return '<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n' +
        '<meta name="robots" content="noindex, nofollow">\n<title>Тренировка недоступна</title>\n</head>\n<body>\n' +
        '<div class="wp"><div class="na-card"><h2>Тренировка недоступна</h2>' +
        '<p>Ссылка устарела, или владелец удалил тренировку и закрыл доступ.</p></div></div>\n</body>\n</html>';
}

http.createServer(function (req, res) {
    /* [UX-I17 T1] предохранители прогонов: падение обработчика (гонка existsSync/statSync,
       запись в прерванное клиентом соединение) раньше убивало процесс — и весь остаток
       прогона e2e сыпался каскадом ECONNREFUSED. Теперь ошибку отдаём как 500/тихо глотаем */
    req.on('error', function () { /* aborted */ });
    res.on('error', function () { /* client aborted mid-write */ });
    try {
        handle(req, res);
    } catch (e) {
        try {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('server error');
        } catch (e2) { /* socket уже мёртв */ }
    }
}).listen(Number(process.env.GYM_TEST_PORT) || 8099, '127.0.0.1', function () {
    console.log('test server: http://127.0.0.1:' + (Number(process.env.GYM_TEST_PORT) || 8099));
});
/* последнее средство: непойманное исключение в async-колбэке (например, JSON.parse вне
   try в будущих правках) не должно ронять сервер посреди прогона */
process.on('uncaughtException', function (e) {
    console.error('test server survived: ' + (e && e.message));
});

function handle(req, res) {
    const raw = req.url;
    const url = raw.split('?')[0];
    if (req.method === 'POST' && url === '/api/reset') {
        store = initialStore();
        trackedEvents = [];
        /* [UX-T29] /api/reset?noprofile=1 — сброс без профиля: сценарий новичка
           (в initialStore по умолчанию legacy-профиль age-only для kcal-тестов) */
        if ((raw.split('?')[1] || '').indexOf('noprofile') >= 0) delete store.profile;
        sendJson(res, 200, { ok: true });
        return;
    }
    /* [ANA-T5] мок /api/track: события онбординга (прод: белой список имён + Stats.inc
       за валидацией initData; здесь подпись не проверяем, только собираем) */
    if (req.method === 'POST' && url === '/api/track') {
        let body = '';
        req.on('data', function (ch) { body += ch; });
        req.on('end', function () {
            try {
                const j = JSON.parse(body);
                if (Array.isArray(j.events)) trackedEvents.push(...j.events);
                sendJson(res, 200, { ok: true });
            } catch (e) {
                sendJson(res, 400, { ok: false });
            }
        });
        return;
    }
    /* [ANA-T5] просмотр собранных событий в e2e */
    if (req.method === 'GET' && url === '/api/track-events') {
        sendJson(res, 200, trackedEvents);
        return;
    }
    if (req.method === 'GET' && url === '/api/state') {
        sendJson(res, 200, store);
        return;
    }
    /* [ONB-T6] мок /health: кнопка «Проверить сервер» в Помощи (прод: лёгкий эндпоинт WebServer) */
    if (req.method === 'GET' && url === '/health') {
        sendJson(res, 200, { ok: true, uptimeSec: 42, chats: 1 });
        return;
    }
    if (req.method === 'POST' && url === '/api/init') {
        sendJson(res, 200, { ok: true, userId: 1, rev: store.rev, botUsername: 'GymHelper_bot', data: store });
        return;
    }
    /* [UX-I16] мок /api/share: shareId создаётся лениво на завершённой тренировке,
       повторный вызов возвращает тот же (§4.2). Прод: WebServer.handleShare */
    if (req.method === 'POST' && url === '/api/share') {
        let body = '';
        req.on('data', function (ch) { body += ch; });
        req.on('end', function () {
            try {
                const j = JSON.parse(body);
                const w = (store.workouts || []).find(function (x) { return x.id === j.wid; });
                if (!w) { sendJson(res, 404, { ok: false }); return; }
                if (!w.finished) { sendJson(res, 400, { ok: false }); return; }
                if (typeof j.shareName === 'boolean') {
                    store.shareName = j.shareName;
                    if (!j.shareName) store.shareOwner = null;
                }
                /* имя в проде сервер берёт сам из проверенного initData (user.first_name);
                   в e2e initData пуст → shareOwner не заполняется (аноним) */
                if (!w.shareId) w.shareId = newShareId();
                sendJson(res, 200, { ok: true, shareId: w.shareId, url: 'http://' + (req.headers.host || '127.0.0.1:8099') + '/w/' + w.shareId });
            } catch (e) {
                sendJson(res, 400, { ok: false });
            }
        });
        return;
    }
    /* [UX-I16] мок GET /w/<shareId>: структура зеркалит Java-страницу SharePage
       (og-теги, noindex, состав §6) — контракт рендера проверяет GymContractTest */
    if (req.method === 'GET' && url.startsWith('/w/')) {
        const sid = url.slice(3);
        const w = (store.workouts || []).find(function (x) { return x.finished && x.shareId === sid; });
        const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
        if (!w) {
            res.writeHead(404, headers);
            res.end(share404Html());
            return;
        }
        res.writeHead(200, headers);
        res.end(shareWorkoutHtml(store, w));
        return;
    }
    if (req.method === 'POST' && url === '/api/save') {
        let body = '';
        req.on('data', function (ch) { body += ch; });
        req.on('end', function () {
            try {
                const j = JSON.parse(body);
                const d = j.data || {};
                if (Array.isArray(d.workouts)) store.workouts = d.workouts;
                if (Array.isArray(d.templates)) store.templates = d.templates;
                /* [GOA-S1] цели — merge по образцу реального WebServer: замещение только
                   при наличии ключа (старый кэш JS — не трогаем); goalRemind — значением */
                if (Array.isArray(d.goals)) store.goals = d.goals;
                if (typeof d.goalRemind === 'boolean') store.goalRemind = d.goalRemind;
                /* restSec: merge-политика реального WebServer — null у клиента (ещё не настраивал)
                   серверное значение не затирает [UX-T4/T5, спека §0.1] */
                if (typeof d.restSec === 'number') store.restSec = d.restSec;
                if (typeof d.nextId === 'number') store.nextId = d.nextId;
                if (Array.isArray(d.del)) store.del = d.del;
                /* ⚠️ отличается от прода: прод делает selective-merge birth-полей ([UX-T29]);
                   мок упрощён — не принимать за контракт */
                if (d.profile) store.profile = d.profile;
                store.rev = (store.rev || 0) + 1;
                sendJson(res, 200, { ok: true, rev: store.rev });
            } catch (e) {
                sendJson(res, 400, { ok: false });
            }
        });
        return;
    }
    /* [EXR-T6] прод декодирует percent-encoding пути (кириллические id каталога типа «pliе»),
       мок должен так же; битый encoding — оставляем как есть → 404 */
    let rel = url === '/' || url === '/app' ? 'index.html' : url.slice(1);
    /* [CNT-T1] рерайт /landing и /landing/ — зеркало прод-WebServer (безредиректно, как
       у / и /app); счётчик landingViews живёт только в проде (Stats.java) — контракт GymContractTest */
    if (rel === 'landing' || rel === 'landing/') rel = 'landing/index.html';
    try { rel = decodeURIComponent(rel); } catch (e) { /* URIError — сырой путь */ }
    /* [EXR-T8] path traversal гвард — как в проде [WebServer]: декодированный путь не содержит
       «..» и канонически остаётся внутри web/; раньше /img/%2e%2e/app.js отдавал соседний файл */
    const file = path.normalize(path.join(root, rel));
    if (rel.split(/[\\/]/).indexOf('..') >= 0
        || path.relative(root, file).startsWith('..')
        || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
        return;
    }
    /* [EXR-T8] прод-логика Cache-Control [EXR-T6]: GET /img/ — public, max-age=604800
       (фото неизменяемы), остальная статика — no-store; раньше мок отдавал всегда no-store.
       [CNT-T1] ассеты лендинга /landing/assets/ — тоже неделя (зеркало прод-WebServer) */
    const img = req.method === 'GET' && (('/' + rel).startsWith('/img/') || ('/' + rel).startsWith('/landing/assets/'));
    res.writeHead(200, {
        'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': img ? 'public, max-age=604800' : 'no-store'
    });
    res.end(fs.readFileSync(file));
}
