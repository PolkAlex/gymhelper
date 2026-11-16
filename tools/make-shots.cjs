'use strict';
/* make-shots.cjs — скриншоты Mini App для README/лендинга.
 * Поднимает тестовый сервер (tests/server-test.js, порт 8099), наполняет демо-данными
 * (4 завершённые тренировки + активная), снимает экраны в docs/screenshots/.
 * Запуск из корня проекта: node tools/make-shots.cjs
 * Зависимости: playwright (dev-зависимость проекта), сам сервер отдельного процесса не нужен. */
const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 8099;
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');

function iso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); }

/* демо-данные: завершённые тренировки с реалистичными упражнениями */
function ex(name, sets, st, en) {
    return { name: name, st: st, en: en, sets: sets };
}
function wo(id, day, title, exercises, finished) {
    return {
        id: id, date: day, started: day + 'T18:30:00',
        ended: finished ? day + 'T19:55:00' : null, finished: !!finished,
        title: title, nutrition: finished ? 'вода, банан' : '',
        exercises: exercises
    };
}
function demoData() {
    const today = iso(new Date());
    return {
        nextId: 20, rev: 1, del: [],
        profile: { sex: 'м', birthYear: 1990, birthMonth: 5, height: 180, weight: 88 },
        restSec: 120,
        templates: [],
        workouts: [
            wo(11, daysAgo(9), '', [ex('Жим штанги лёжа', [{ w: 80, s: 4, r: '8-10', t: daysAgo(9) + 'T18:35:00' }], daysAgo(9) + 'T18:32:00', daysAgo(9) + 'T19:20:00'),
                ex('Тяга верхнего блока', [{ w: 65, s: 3, r: '10-12', t: daysAgo(9) + 'T19:25:00' }], daysAgo(9) + 'T19:22:00', daysAgo(9) + 'T19:50:00')], true),
            wo(12, daysAgo(6), '', [ex('Приседания со штангой', [{ w: 110, s: 5, r: '5', t: daysAgo(6) + 'T18:35:00' }], daysAgo(6) + 'T18:33:00', daysAgo(6) + 'T19:30:00'),
                ex('Жим ногами', [{ w: 180, s: 3, r: '12', t: daysAgo(6) + 'T19:35:00' }], daysAgo(6) + 'T19:32:00', daysAgo(6) + 'T19:52:00')], true),
            wo(13, daysAgo(3), '', [ex('Подтягивания', [{ w: 0, s: 4, r: '8', t: daysAgo(3) + 'T18:32:00' }], daysAgo(3) + 'T18:31:00', daysAgo(3) + 'T19:05:00'),
                ex('Отжимания на брусьях', [{ w: 10, s: 3, r: '10', t: daysAgo(3) + 'T19:10:00' }], daysAgo(3) + 'T19:06:00', daysAgo(3) + 'T19:25:00'),
                ex('Подъём штанги на бицепс', [{ w: 35, s: 3, r: '10-12', t: daysAgo(3) + 'T19:30:00' }], daysAgo(3) + 'T19:26:00', daysAgo(3) + 'T19:50:00')], true),
            wo(14, today, '', [ex('Жим штанги лёжа', [
                { w: 85, s: 1, r: '8', t: today + 'T18:40:00' }, { w: 85, s: 1, r: '8', t: today + 'T18:52:00' },
                { w: 87.5, s: 1, r: '6', t: today + 'T19:04:00' }], today + 'T18:38:00', null)], false)
        ]
    };
}

async function waitServer() {
    for (let i = 0; i < 40; i++) {
        try {
            await fetch('http://127.0.0.1:' + PORT + '/health');
            return true;
        } catch (e) { await new Promise(r => setTimeout(r, 250)); }
    }
    throw new Error('server did not start');
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const srv = spawn(process.execPath, [path.join(__dirname, '..', 'tests', 'server-test.js')], { stdio: 'ignore' });
    try {
        await waitServer();
        await fetch('http://127.0.0.1:' + PORT + '/api/reset', { method: 'POST' });
        await fetch('http://127.0.0.1:' + PORT + '/api/save', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: demoData() })
        });

        const b = await chromium.launch();
        const ctx = await b.newContext({
            viewport: { width: 390, height: 780 }, deviceScaleFactor: 2,
            isMobile: true, hasTouch: true, locale: 'ru-RU'
        });
        await ctx.addInitScript(function () {
            try {
                localStorage.setItem('gymOnbDone', '1');
                localStorage.setItem('gymWnOff', '1');
                localStorage.setItem('gymHelpSeen', '1');
                localStorage.setItem('gymTheme', 'dark'); /* [CNT-T1] кадры лендинга — тёмная тема (как обещает подпись секции) */
            } catch (e) { /* noop */ }
        });
        const p = await ctx.newPage();
        await p.goto('http://127.0.0.1:' + PORT + '/');
        await p.waitForSelector('#app .hero, #app .pcard', { timeout: 10000 });
        await p.waitForTimeout(700);

        /* 1. Главная: карточка активной тренировки поверх истории */
        await p.screenshot({ path: path.join(OUT, '01-home.png') });

        /* 2. Карточка активной тренировки с подходами */
        const prev = p.locator('.pcard, .expill').first();
        if (await prev.isVisible().catch(() => false)) {
            await prev.click();
            await p.waitForTimeout(600);
            await p.screenshot({ path: path.join(OUT, '02-workout-card.png') });
            /* [CNT-T1] кнопка календаря в топбаре скрыта при открытой карточке (viewWid) —
               сначала «← Назад» backbar'а (closeHistory), потом топбар снова с [📅] */
            const closeCard = p.locator('.backbar [data-act="closeHistory"]').first();
            if (await closeCard.isVisible().catch(() => false)) {
                await closeCard.click();
                await p.waitForTimeout(400);
            }
        }

        /* 3. Календарь */
        const cal = p.locator('[data-act="openCal"]').first();
        if (await cal.isVisible().catch(() => false)) {
            await cal.click();
            await p.waitForTimeout(600);
            await p.screenshot({ path: path.join(OUT, '03-calendar.png') });
            const back = p.locator('[data-act="closeCal"]').first();
            if (await back.isVisible().catch(() => false)) { await back.click(); await p.waitForTimeout(300); }
        }

        /* 4. Техника (каталог с фото) */
        await p.locator('.nbtn[data-a="tech"]').first().click();
        await p.waitForTimeout(1200); /* фото */
        await p.screenshot({ path: path.join(OUT, '04-catalog.png') });

        /* 5. Статистика */
        await p.locator('.nbtn[data-a="stats"]').first().click();
        await p.waitForTimeout(600);
        await p.screenshot({ path: path.join(OUT, '05-stats.png') });

        /* 6. История */
        await p.locator('.nbtn[data-a="history"]').first().click();
        await p.waitForTimeout(600);
        await p.screenshot({ path: path.join(OUT, '06-history.png') });

        /* 7. Настройки/Профиль */
        const gear = p.locator('[data-act="openSettings"]').first();
        if (await gear.isVisible().catch(() => false)) {
            await gear.click();
            await p.waitForTimeout(600);
            await p.screenshot({ path: path.join(OUT, '07-settings.png') });
        }

        const files = fs.readdirSync(OUT).filter(f => f.endsWith('.png'));
        console.log('OK, скриншотов: ' + files.length + ' -> ' + OUT);
        files.forEach(f => console.log('  ' + f + ' (' + Math.round(fs.statSync(path.join(OUT, f)).size / 1024) + ' KB)'));
        await b.close();
    } catch (e) {
        console.error('FAIL: ' + e.message);
        process.exitCode = 1;
    } finally {
        srv.kill();
    }
})();
