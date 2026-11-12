'use strict';
/* Тестовый сервер: отдаёт web/ и заглушку API (без проверки Telegram-подписи). Порт 8099. */
const http = require('http');
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
        templates: []
    };
}
let store = initialStore();

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

http.createServer(function (req, res) {
    const raw = req.url;
    const url = raw.split('?')[0];
    if (req.method === 'POST' && url === '/api/reset') {
        store = initialStore();
        /* [UX-T29] /api/reset?noprofile=1 — сброс без профиля: сценарий новичка
           (в initialStore по умолчанию legacy-профиль age-only для kcal-тестов) */
        if ((raw.split('?')[1] || '').indexOf('noprofile') >= 0) delete store.profile;
        sendJson(res, 200, { ok: true });
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
    if (req.method === 'POST' && url === '/api/save') {
        let body = '';
        req.on('data', function (ch) { body += ch; });
        req.on('end', function () {
            try {
                const j = JSON.parse(body);
                const d = j.data || {};
                if (Array.isArray(d.workouts)) store.workouts = d.workouts;
                if (Array.isArray(d.templates)) store.templates = d.templates;
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
       (фото неизменяемы), остальная статика — no-store; раньше мок отдавал всегда no-store */
    const img = ('/' + rel).startsWith('/img/') && req.method === 'GET';
    res.writeHead(200, {
        'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': img ? 'public, max-age=604800' : 'no-store'
    });
    res.end(fs.readFileSync(file));
}).listen(8099, '127.0.0.1', function () {
    console.log('test server: http://127.0.0.1:8099');
});
