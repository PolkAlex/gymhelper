'use strict';
/* make-og.cjs — генерация OG-картинки (1200×630) и favicon для лендинга из скриншотов продукта.
 * Запуск из корня: node tools/make-og.cjs → web/landing/assets/{og.png, favicon.png, apple-touch.png}
 * Ноль зависимостей кроме playwright (dev-зависимость): рендерим HTML → screenshot. */
const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'web', 'landing', 'assets');
const SHOTS = path.join(__dirname, '..', 'docs', 'screenshots');
const fileUrl = p => 'file:///' + p.replace(/\\/g, '/');

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const b = await chromium.launch();

    /* OG 1200×630: hero с двумя скриншотами продукта */
    const og = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    await og.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { width:1200px; height:630px; overflow:hidden; font-family:"Segoe UI",system-ui,sans-serif;
            background:#101114; color:#f2f4f8; position:relative; }
        .glow { position:absolute; width:900px; height:900px; border-radius:50%;
            background:radial-gradient(circle, rgba(255,194,32,.16) 0%, rgba(255,194,32,0) 60%);
            top:-300px; left:-200px; }
        .glow2 { position:absolute; width:700px; height:700px; border-radius:50%;
            background:radial-gradient(circle, rgba(77,163,255,.10) 0%, rgba(77,163,255,0) 60%);
            bottom:-350px; right:-150px; }
        .l { position:absolute; left:72px; top:150px; width:560px; }
        h1 { font-size:58px; line-height:1.1; font-weight:700; }
        h1 span { color:#ffc220; }
        .sub { margin-top:22px; font-size:26px; color:#aeb9c6; line-height:1.45; }
        .cta { display:inline-block; margin-top:34px; padding:14px 34px; background:#ffc220; color:#181203;
            border-radius:14px; font-size:24px; font-weight:700; }
        .phone { position:absolute; border-radius:22px; overflow:hidden; border:3px solid rgba(255,255,255,.14);
            box-shadow:0 24px 70px rgba(0,0,0,.55); }
        .p1 { right:330px; top:92px; width:248px; transform:rotate(-4deg); }
        .p2 { right:86px; top:158px; width:248px; transform:rotate(5deg); }
        img { width:100%; display:block; }
        .tag { position:absolute; left:72px; bottom:52px; color:#6d7a88; font-size:19px; }
    </style></head><body>
        <div class="glow"></div><div class="glow2"></div>
        <div class="l">
            <h1>Дневник тренировок <span>в Telegram</span></h1>
            <div class="sub">Ноль установки и регистрации. 254 упражнения с фото, календарь, статистика, рекорды.</div>
            <div class="cta">Запустить в Telegram</div>
        </div>
        <div class="phone p1"><img src="${fileUrl(path.join(SHOTS, '01-home.png'))}"></div>
        <div class="phone p2"><img src="${fileUrl(path.join(SHOTS, '05-stats.png'))}"></div>
        <div class="tag">gym-helper.com · @MyHelperGymBot · бесплатно</div>
    </body></html>`);
    await og.waitForTimeout(700);
    await og.screenshot({ path: path.join(OUT, 'og.png') });

    /* favicon 64 + apple-touch 180 */
    async function icon(size, name) {
        const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
        await p.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
            * { margin:0; }
            body { width:${size}px; height:${size}px; background:#101114; display:flex; align-items:center;
                justify-content:center; overflow:hidden; border-radius:${Math.round(size * 0.2)}px; }
            .e { font-size:${Math.round(size * 0.62)}px; line-height:1; }
            .bg { position:absolute; width:${size}px; height:${size}px;
                background:radial-gradient(circle at 30% 25%, rgba(255,194,32,.25), rgba(16,17,20,0) 65%); }
        </style></head><body><div class="bg"></div><div class="e">💪</div></body></html>`);
        await p.waitForTimeout(250);
        await p.screenshot({ path: path.join(OUT, name), clip: { x: 0, y: 0, width: size, height: size } });
        await p.close();
    }
    await icon(64, 'favicon.png');
    await icon(180, 'apple-touch.png');

    ['og.png', 'favicon.png', 'apple-touch.png'].forEach(f =>
        console.log('OK ' + f + ' (' + Math.round(fs.statSync(path.join(OUT, f)).size / 1024) + ' KB)'));
    await b.close();
})().catch(e => { console.error('FAIL: ' + e.message); process.exit(1); });
