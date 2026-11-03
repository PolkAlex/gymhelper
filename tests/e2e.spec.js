const { test, expect } = require('@playwright/test');

const EX = 'Жим штанги лёжа';

test.beforeEach(async function ({ request }) {
    await request.post('/api/reset');
});

/* захват тестового крюка приложения до загрузки app.js */
test.beforeEach(async function ({ context }) {
    await context.addInitScript(function () {
        window.__gymExpose = function (api) { window.__gym = api; };
    });
});


async function openApp(page) {
    await page.goto('/');
    await expect(page.locator('#app .hero')).toBeVisible({ timeout: 10000 });
}
async function startAndPick(page, name) {
    await page.locator('[data-act="startWorkout"]').click();
    const modal = page.locator('.modal.open');
    await modal.waitFor({ state: 'visible', timeout: 5000 });
    await modal.locator('.excard', { hasText: name }).first().click();
    await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 });
}
/* активная тренировка на вкладке Тренировка свёрнута в пилюлю — тап открывает её карточку */
async function startWorkoutUi(page) {
    await page.locator('[data-act="startWorkout"]').click();
    await expect(page.locator('.modal.open')).toBeVisible({ timeout: 5000 });
    await page.locator('.modal.open [data-act="closeModal"]').click();
    await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
}
async function openActiveDetail(page) {
    if (await page.locator('.expill').first().isVisible().catch(function () { return false; })) return;
    /* уже внутри карточки (после старта попадаем сразу сюда) */
    if (await page.locator('.backbar').isVisible().catch(function () { return false; })) return;
    await page.locator('.wrow').first().click();
    await expect(page.locator('.wcicons').first()).toBeVisible({ timeout: 5000 });
}

test.describe('GymHelper e2e', function () {

    test('старт: пикер открывается сразу после начала тренировки', async ({ page }) => {
        await openApp(page);
        await page.locator('[data-act="startWorkout"]').click();
        /* после старта — сразу экран редактирования (карточка тренировки), а не Главный */
        await expect(page.locator('.modal.open')).toBeVisible({ timeout: 5000 });
        await page.locator('.modal.open [data-act="closeModal"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await expect(page.locator('.wcpill')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.backbar', { hasText: 'Сохранить' })).toBeVisible({ timeout: 5000 });

        await openActiveDetail(page);
        await page.locator('[data-act="openPicker"]').click();
        await page.locator('#pickerList .excard', { hasText: EX }).first().click();
        await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 });
        await page.locator('#mWeight').fill('100');
        await page.locator('#mSets').fill('3');
        await page.locator('#mReps').fill('8-10');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });

        await openActiveDetail(page);
        await expect(page.locator('.expill .entry').first()).toContainText('100 кг, 3 подхода по 8-10 повторений', { timeout: 5000 });
    });

    test('записи переживают перезагрузку страницы', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await page.locator('#mWeight').fill('80');
        await page.locator('#mSets').fill('4');
        await page.locator('#mReps').fill('10');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible();

        await page.reload();
        await openActiveDetail(page);
        await expect(page.locator('.expill .entry').first()).toContainText('80 кг, 4 подхода по 10 повторений', { timeout: 10000 });
    });

    test('редактирование записи', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await page.locator('#mWeight').fill('100');
        await page.locator('#mSets').fill('3');
        await page.locator('#mReps').fill('8-10');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible();

        await openActiveDetail(page);
        await page.locator('.expill .entry').first().click();
        await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 });
        await page.locator('#mWeight').fill('110');
        await page.locator('#mSets').fill('5');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });

        await openActiveDetail(page);
        await expect(page.locator('.expill .entry').first()).toContainText('110 кг, 5 подходов по 8-10 повторений', { timeout: 5000 });
    });

    test('удаление записи', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await page.locator('#mWeight').fill('100');
        await page.locator('#mSets').fill('3');
        await page.locator('#mReps').fill('8-10');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible();

        await openActiveDetail(page);
        await page.locator('.expill .entry').click();
        await page.locator('.modal.open [data-act="deleteEntry"]').click();
        await expect(page.locator('.expill .entry')).toHaveCount(0, { timeout: 5000 });
    });

    test('удаление упражнения вместе с записями', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await page.locator('#mWeight').fill('100');
        await page.locator('#mSets').fill('3');
        await page.locator('#mReps').fill('8-10');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible();

        await openActiveDetail(page);
        await page.locator('.expill .exhead [data-act="deleteExercise"]').click();
        await page.locator('.modal.open [data-act="confirmYes"]').click();
        await expect(page.locator('.expill')).toHaveCount(0, { timeout: 5000 });
    });

    test('переименование упражнения', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await page.locator('#mWeight').fill('100');
        await page.locator('#mSets').fill('3');
        await page.locator('#mReps').fill('8-10');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible();

        await openActiveDetail(page);
        await page.locator('.expill .exhead .exname').click();
        await page.locator('#mName').fill('Жим стоя');
        await page.locator('[data-act="doRename"]').click();

        await expect(page.locator('.expill .exname')).toContainText('Жим стоя', { timeout: 5000 });
    });

    test('завершение тренировки: уходит в историю с датой и пилюлей', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await page.locator('#mWeight').fill('100');
        await page.locator('#mSets').fill('3');
        await page.locator('#mReps').fill('8-10');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible();

        await openActiveDetail(page);
        await page.locator('[data-act="finishWorkout"]').click();
        await expect(page.locator('.wcicons [data-act="confirmModal"]')).toBeVisible({ timeout: 5000 });
        await page.locator('.nav button', { hasText: 'История' }).click();
        await expect(page.locator('.pcard').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.pc-date')).toContainText('.', { timeout: 5000 });
    });

    test('удаление тренировки с подтверждением', async ({ page }) => {
        await openApp(page);
        await startWorkoutUi(page);
        await openActiveDetail(page);
        await page.locator('.wcicons [data-act="confirmModal"]').click();
        await page.locator('.modal.open [data-act="confirmYes"]').click();
        await expect(page.locator('.empty')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.pcard')).toHaveCount(0);
    });

    test('фильтры каталога в пикере', async ({ page }) => {
        await openApp(page);
        await startWorkoutUi(page);
        await openActiveDetail(page);
        await page.locator('[data-act="openPicker"]').click();
        const logs = [];
        page.on('console', function (msg) { logs.push(msg.text()); });
        const modal = page.locator('.modal.open');
        await modal.locator('.secrow .chip', { hasText: 'Вид' }).click();
        await expect(page.locator('.modal.open .secrow .chip', { hasText: 'Жим' })).toBeVisible({ timeout: 5000 });
        await modal.locator('.secrow .chip', { hasText: 'Жим' }).click();
        await expect(page.locator('#pickerList .excard').first()).toBeVisible({ timeout: 5000 });
        console.log('PICKER LOGS:\n' + logs.join('\n'));
    });

    test('навигация по вкладкам, тренер и профиль', async ({ page }) => {
        await openApp(page);
        for (const label of ['История', 'Тренер', 'Техника', 'Статистика']) {
            await page.locator('.nav button', { hasText: label }).click();
            await expect(page.locator('.tb-title')).toContainText('GymHelper · ' + label, { timeout: 5000 });
        }
        await page.locator('.topbar .tb-user').click();
        await expect(page.locator('#app .themegrid')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.themecard.on')).toHaveCount(1);
    });

    test('время и дата тренировки: маски ввода', async ({ page }) => {
        await openApp(page);
        await startWorkoutUi(page);
        await openActiveDetail(page);
        await page.locator('.wcicons [data-act="timeModal"]').click();
        await page.locator('#mStartDate').fill('29.10.2026');
        await page.locator('#mStartTime').fill('0930');
        await page.locator('[data-act="saveTime"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await expect(page.locator('.wpill', { hasText: '09:30' })).toBeVisible({ timeout: 5000 });
    });

    test('время окончания вводят руками: сохраняется и переживает завершение', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await page.locator('#mWeight').fill('50');
        await page.locator('#mSets').fill('1');
        await page.locator('#mReps').fill('10');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await openActiveDetail(page);
        await page.locator('.wcicons [data-act="timeModal"]').click();
        await page.locator('#mStartTime').fill('1000');
        await page.locator('#mEndTime').fill('1130');
        await page.locator('[data-act="saveTime"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await page.locator('[data-act="finishWorkout"]').click();
        await expect(page.locator('.wpill', { hasText: '10:00–11:30' })).toBeVisible({ timeout: 5000 });
    });

    test('своё упражнение сохраняется в базе', async ({ page }) => {
        await openApp(page);
        await startWorkoutUi(page);
        await openActiveDetail(page);
        await page.locator('[data-act="openPicker"]').click();
        await page.locator('[data-act="customExerciseModal"]').click();
        await page.locator('#mCustomName').fill('Тяга гантели в планке');
        await page.locator('[data-act="createCustom"]').click();
        await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 });
        await page.locator('#mWeight').fill('20');
        await page.locator('#mSets').fill('3');
        await page.locator('#mReps').fill('10');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });

        await page.locator('[data-act="openPicker"]').click();
        await page.locator('.modal.open .secrow .chip', { hasText: 'Коллекции' }).click();
        await page.locator('.modal.open #pickerCats .chip', { hasText: 'Свои' }).click();
        await expect(page.locator('#pickerList .excard', { hasText: 'Тяга гантели в планке' })).toBeVisible({ timeout: 5000 });

        await page.locator('.modal.open .secrow .chip', { hasText: 'Все' }).first().click();
        await expect(page.locator('#pickerList .excard', { hasText: 'Тяга гантели в планке' })).toBeVisible({ timeout: 5000 });
    });

    test('название тренировки', async ({ page }) => {
        await openApp(page);
        await startWorkoutUi(page);
        await openActiveDetail(page);
        await page.locator('.wctitles').click();
        await page.locator('#mTitle').fill('Спина и грудь');
        await page.locator('[data-act="saveTitle"]').click();
        await expect(page.locator('.wctitles .t1', { hasText: 'Спина и грудь' })).toBeVisible({ timeout: 5000 });
    });

    test('шапка карточки: название на уровне иконок, время/длительность/ккал в пилюлях', async ({ page, request }) => {
        /* готовая завершённая тренировка: интервал 09:30–10:30, упражнение 29 минут — ккал гарантированно > 0 */
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            profile: { sex: 'м', age: 30, height: 180, weight: 90 },
            workouts: [{
                id: 1, date: '2026-10-29',
                started: '2026-10-29T09:30:00', ended: '2026-10-29T10:30:00',
                finished: true, title: '', nutrition: '',
                exercises: [{
                    name: EX, st: '2026-10-29T09:31:00', en: '2026-10-29T10:00:00',
                    sets: [{ w: '100', s: 3, r: '8-10', t: '2026-10-29T09:32:00' }]
                }]
            }]
        } } });
        await page.goto('/');
        await expect(page.locator('#app .hero')).toBeVisible({ timeout: 10000 });
        await page.locator('.pcard').first().click();
        await expect(page.locator('.wcicons').first()).toBeVisible({ timeout: 5000 });

        /* ровно три значения: время, ккал, подходы. Длительности внутри быть не должно */
        await expect(page.locator('.wpill.wp-r')).toContainText('09:30–10:30', { timeout: 5000 });
        await expect(page.locator('.wpill.wp-k')).toContainText('ккал', { timeout: 5000 });
        await expect(page.locator('.wpill.wp-s')).toContainText('подх.', { timeout: 5000 });
        /* часовая тренировка с записями, занесёнными за минуту: ккал считаем по длительности ТРЕНИРОВКИ */
        const kcalDigits = ((await page.locator('.wpill.wp-k').textContent()).match(/\d+/) || ['0'])[0];
        if (+kcalDigits < 100) throw new Error('ккал подозрительно мало для часовой тренировки: ' + kcalDigits);
        const wpillCount = await page.locator('.wpill').count();
        if (wpillCount !== 3) throw new Error('строк в пилюле: ' + wpillCount + ', ожидалось 3');
        if (await page.locator('.wpill.wp-d').count()) throw new Error('длительность осталась в пилюле');

        /* название тренировки и иконки карандаша/часов/корзины — на одном уровне */
        const t1 = await page.locator('.wchead .t1').boundingBox();
        const icons = await page.locator('.wcicons').boundingBox();
        if (!t1 || !icons) throw new Error('шапка карточки не найдена');
        const d = Math.abs((t1.y + t1.height / 2) - (icons.y + icons.height / 2));
        if (d > 8) throw new Error('название и иконки не на одном уровне: ' + d.toFixed(1) + 'px');

        /* инфо-лента: одна строка на всю ширину ниже названия, три значения на одном уровне */
        const pillBox = await page.locator('.wcpill').boundingBox();
        const icBox = await page.locator('.wcicons').boundingBox();
        const t1Box = await page.locator('.wctitles .t1').boundingBox();
        if (!pillBox || !icBox || !t1Box) throw new Error('шапка карточки не найдена');
        const edge = Math.abs((pillBox.x + pillBox.width) - (icBox.x + icBox.width));
        if (edge > 2) throw new Error('пилюля не растянута до правого края: ' + edge.toFixed(1) + 'px');
        if (pillBox.y < t1Box.y) throw new Error('пилюля выше названия');
        const rows = await page.locator('.wpill').all();
        const centers = [];
        const hs = [];
        for (const p of rows) {
            const bb = await p.boundingBox();
            centers.push(bb.y + bb.height / 2);
            hs.push(bb.height);
        }
        const centerSpread = Math.max.apply(null, centers) - Math.min.apply(null, centers);
        if (centerSpread > 2) throw new Error('значения пилюли не в одной строке: ' + centerSpread.toFixed(1) + 'px');
        if (Math.max.apply(null, hs) - Math.min.apply(null, hs) > 2) throw new Error('значения пилюли разной высоты');

        /* ккал не «выпадает» из шапки: пилюля выше карточек упражнений */
        const kcal = await page.locator('.wpill.wp-k').boundingBox();
        const firstEx = await page.locator('.expill').first().boundingBox();
        if (kcal.y + kcal.height > firstEx.y) throw new Error('пилюля ккал провалилась ниже карточки упражнения');
    });

    test('запись не теряется, если сохранение на сервер не ушло', async ({ page }) => {
        let failSave = true;
        await page.route('**/api/save', function (route) {
            if (failSave) route.abort();
            else route.fallback();
        });
        await openApp(page);
        await startAndPick(page, EX);
        await page.locator('#mWeight').fill('100');
        await page.locator('#mSets').fill('3');
        await page.locator('#mReps').fill('8-10');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await openActiveDetail(page);
        await expect(page.locator('.expill .entry').first()).toBeVisible({ timeout: 5000 });

        failSave = false;
        await page.locator('[data-act="saveWorkout"]').click();
        await expect(page.locator('.toast.show')).toBeVisible({ timeout: 5000 });
        await page.reload();
        await expect(page.locator('#app .hero')).toBeVisible({ timeout: 10000 });
        await openActiveDetail(page);
        await expect(page.locator('.expill .entry').first()).toBeVisible({ timeout: 5000 });
    });

    test('превью-карточки: дата как в шапке (эмодзи + дд.мм, дн), жирное название, правый угол без дня недели', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await page.locator('#mWeight').fill('100');
        await page.locator('#mSets').fill('3');
        await page.locator('#mReps').fill('8-10');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await openActiveDetail(page);
        await page.locator('.wctitles').click();
        await page.locator('#mTitle').fill('Вечерняя программа');
        await page.locator('[data-act="saveTitle"]').click();
        await expect(page.locator('.wctitles .t1', { hasText: 'Вечерняя программа' })).toBeVisible({ timeout: 5000 });
        await page.locator('[data-act="finishWorkout"]').click();
        await page.locator('.nav button', { hasText: 'История' }).click();
        await expect(page.locator('.pcard').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.pcard').first()).toBeVisible({ timeout: 5000 });
        /* своё название тренировки показывается В СТРОКЕ ДАТЫ, а не отдельной строкой среди упражнений */
        await expect(page.locator('.pc-date', { hasText: 'Вечерняя программа' }).first()).toBeVisible({ timeout: 5000 });
        const dateTxt = ((await page.locator('.pc-date').first().textContent()) || '').trim();
        if (!dateTxt.includes('Вечерняя программа')) throw new Error('название тренировки не в строке даты: ' + JSON.stringify(dateTxt));
        const exTexts = await page.locator('.pc-ex').allTextContents();
        for (const t of exTexts) {
            if (t.includes('Вечерняя программа')) throw new Error('название тренировки попало в список упражнений: ' + t);
        }
        const pill = page.locator('.pc-pill');
        if (await pill.count()) {
            const pillTxt = (await pill.first().textContent()) || '';
            if (/утро|день|вечер/.test(pillTxt)) throw new Error('в пилюле день-части остался текст: ' + pillTxt);
        }
        const dowTxt = (await page.locator('.pc-dow').first().textContent()) || '';
        if (dowTxt.includes('·')) throw new Error('в правом углу остался день недели: ' + dowTxt);
        if (!/^\d{1,2}\s[а-яё]+$/i.test(dowTxt.trim())) throw new Error('формат даты в правом углу: ' + dowTxt);
        /* дата и правый угол на одном уровне; пилюля по центру блока упражнений (один кадр, без скролла) */
        const m = await page.evaluate(function () {
            function cy(el) {
                const r = el.getBoundingClientRect();
                return r.y + r.height / 2;
            }
            const card = document.querySelector('.pcard');
            if (!card) return { err: 'нет превью-карточки' };
            const dateEl = card.querySelector('.pc-date');
            const dowEl = card.querySelector('.pc-dow');
            const pillEl = card.querySelector('.pc-right');
            const exEls = card.querySelectorAll('.pc-ex');
            if (!dateEl || !dowEl || !pillEl || !exEls.length) return { err: 'нет элементов шапки' };
            const dOff = Math.abs(cy(dateEl) - cy(dowEl));
            const dowTxt = (dowEl.textContent || '').trim();
            /* центр левой колонки = объединение названия (если есть) и строк упражнений */
            const parts = [];
            const titleEl = card.querySelector('.pc-title');
            if (titleEl) parts.push(titleEl);
            Array.prototype.forEach.call(exEls, function (el) { parts.push(el); });
            let top = null, bottom = null;
            parts.forEach(function (el) {
                const r = el.getBoundingClientRect();
                if (top === null || r.y < top) top = r.y;
                if (bottom === null || r.y + r.height > bottom) bottom = r.y + r.height;
            });
            const pr = pillEl.getBoundingClientRect();
            const contentCenter = (top + bottom) / 2;
            const pOff = Math.abs(pr.y + pr.height / 2 - contentCenter);
            /* «2 ноя» по центру оси пилюли */
            const dowCx = dowEl.getBoundingClientRect().x + dowEl.getBoundingClientRect().width / 2;
            const pillCx = pr.x + pr.width / 2;
            const dCxOff = Math.abs(dowCx - pillCx);
            return { dOff: dOff, pOff: pOff, dowTxt: dowTxt, dCxOff: dCxOff };
        });
        if (m.err) throw new Error(m.err);
        if (m.dOff > 3) throw new Error('«2 ноя» не на уровне названия: ' + m.dOff.toFixed(1) + 'px');
        if (m.pOff > 3) throw new Error('пилюля не по центру контента карточки: ' + m.pOff.toFixed(1) + 'px');
        if (m.dCxOff > 2) throw new Error('«2 ноя» не по центру оси пилюли: ' + m.dCxOff.toFixed(1) + 'px');
    });

    test('любимые пустые -> пустой список; фильтр Все -> весь каталог', async ({ page }) => {
        await openApp(page);
        await startWorkoutUi(page);
        await openActiveDetail(page);
        await page.locator('[data-act="openPicker"]').click();
        await page.locator('.modal.open .secrow .chip', { hasText: 'Любимые' }).click();
        await expect(page.locator('#pickerList')).toContainText('Избранных пока нет', { timeout: 5000 });
        await expect(page.locator('#pickerList .excard')).toHaveCount(0);

        await page.locator('.modal.open .secrow .chip', { hasText: 'Все' }).first().click();
        const total = await page.locator('#pickerList .excard').count();
        if (total < 60) throw new Error('в каталоге должно быть 75 упражнений, найдено: ' + total);
    });

    test('выбор группы мышц подсвечивает чип и фильтрует список', async ({ page }) => {
        await openApp(page);
        await startWorkoutUi(page);
        await openActiveDetail(page);
        await page.locator('[data-act="openPicker"]').click();
        await page.locator('.modal.open .secrow .chip', { hasText: 'Мышцы' }).click();
        const back = page.locator('.modal.open .secrow .chip', { hasText: 'Спина' });
        await back.click();
        await expect(back).toHaveClass(/on/, { timeout: 5000 });
        await expect(page.locator('#pickerList .excard', { hasText: 'Подтягивания' }).first()).toBeVisible({ timeout: 5000 });
    });

    test('звезда добавляет в любимые', async ({ page }) => {
        await openApp(page);
        await startWorkoutUi(page);
        await openActiveDetail(page);
        await page.locator('[data-act="openPicker"]').click();
        const card = page.locator('#pickerList .excard', { hasText: 'Жим штанги лёжа' }).first();
        await card.locator('.star').click();
        await expect(page.locator('#pickerList .excard', { hasText: 'Жим штанги лёжа' }).locator('.star')).toHaveClass(/fav/, { timeout: 5000 });

        await page.locator('.modal.open .secrow .chip', { hasText: 'Любимые' }).click();
        await expect(page.locator('#pickerList .excard')).toHaveCount(1);
        await expect(page.locator('#pickerList .excard', { hasText: 'Жим штанги лёжа' })).toBeVisible();
    });

    test('навигация сворачивается при скролле и разворачивается наверху', async ({ page }) => {
        await openApp(page);
        await page.evaluate(function () { document.body.style.minHeight = '2200px'; });
        await page.evaluate(function () { window.scrollTo(0, 500); });
        await expect(page.locator('.nav.min')).toHaveCount(1, { timeout: 5000 });
        await page.evaluate(function () { window.scrollTo(0, 0); });
        await expect(page.locator('.nav.min')).toHaveCount(0, { timeout: 5000 });
    });

    test('вес: кнопки +N прибавляют к значению, дефолт 0', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await expect(page.locator('#mWeight')).toHaveValue('0');
        await page.locator('[data-act="wAdd"][data-a="20"]').click();
        await page.locator('[data-act="wAdd"][data-a="15"]').click();
        await expect(page.locator('#mWeight')).toHaveValue('35');
        await page.locator('[data-act="setsSet"][data-a="2"]').click();
        await page.locator('[data-act="repsSet"][data-a="12"]').click();
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await openActiveDetail(page);
        await expect(page.locator('.expill .entry').first()).toContainText('35 кг, 2 подхода по 12 повторений', { timeout: 5000 });
    });

    test('вес 0 — в записи без веса (не пишем «0 кг»)', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await expect(page.locator('#mWeight')).toHaveValue('0');
        await page.locator('[data-act="setsSet"][data-a="1"]').click();
        await page.locator('[data-act="repsSet"][data-a="12"]').click();
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await openActiveDetail(page);
        const entry = page.locator('.expill .entry').first();
        await expect(entry).toContainText('1 подход по 12 повторений', { timeout: 5000 });
        const entryTxt = await entry.textContent();
        if (entryTxt.includes('кг') || entryTxt.includes('0')) throw new Error('нулевая масса попала в запись: ' + entryTxt);
    });

    test('подходы и повторения кнопками: 8 + 2 = 10', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await page.locator('[data-act="setsSet"][data-a="5"]').click();
        await expect(page.locator('#mSets')).toHaveValue('5');
        await page.locator('[data-act="repsSet"][data-a="8"]').click();
        await expect(page.locator('#mReps')).toHaveValue('8');
        await page.locator('[data-act="repsAdd"][data-a="2"]').click();
        await expect(page.locator('#mReps')).toHaveValue('10');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await openActiveDetail(page);
        await expect(page.locator('.expill .entry').first()).toContainText('5 подходов по 10 повторений', { timeout: 5000 });
    });

    test('редактирование записи: +10 к существующим 100 = 110', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await page.locator('#mWeight').fill('100');
        await page.locator('[data-act="setsSet"][data-a="1"]').click();
        await page.locator('[data-act="repsSet"][data-a="10"]').click();
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await openActiveDetail(page);
        await page.locator('.expill .entry').first().click();
        await expect(page.locator('#mWeight')).toHaveValue('100', { timeout: 5000 });
        await page.locator('[data-act="wAdd"][data-a="10"]').click();
        await expect(page.locator('#mWeight')).toHaveValue('110');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await openActiveDetail(page);
        await expect(page.locator('.expill .entry').first()).toContainText('110 кг', { timeout: 5000 });
    });

    test('вес: +0,5 и +50, запятая в записи', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await page.locator('[data-act="wAdd"][data-a="0.5"]').click();
        await page.locator('[data-act="wAdd"][data-a="50"]').click();
        await expect(page.locator('#mWeight')).toHaveValue('50.5');
        await page.locator('[data-act="setsSet"][data-a="1"]').click();
        await page.locator('[data-act="repsSet"][data-a="12"]').click();
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await openActiveDetail(page);
        await expect(page.locator('.expill .entry').first()).toContainText('50,5 кг, 1 подход по 12 повторений', { timeout: 5000 });
    });

    test('вес: быстрые значения 10-200', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await page.locator('[data-act="wSet"][data-a="100"]').click();
        await expect(page.locator('#mWeight')).toHaveValue('100');
        await page.locator('[data-act="wSet"][data-a="60"]').click();
        await expect(page.locator('#mWeight')).toHaveValue('60');
        await page.locator('[data-act="setsSet"][data-a="3"]').click();
        await page.locator('[data-act="repsSet"][data-a="10"]').click();
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await openActiveDetail(page);
        await expect(page.locator('.expill .entry').first()).toContainText('60 кг, 3 подхода по 10 повторений', { timeout: 5000 });
    });

    test('повторения: ряд 1-8 и нижний 9-12/+N', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await page.locator('[data-act="repsSet"][data-a="7"]').click();
        await page.locator('[data-act="repsAdd"][data-a="10"]').click();
        await expect(page.locator('#mReps')).toHaveValue('17');
        await page.locator('[data-act="setsSet"][data-a="7"]').click();
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await openActiveDetail(page);
        await expect(page.locator('.expill .entry').first()).toContainText('7 подходов по 17 повторений', { timeout: 5000 });
    });

    test('кнопки «Очистить» сбрасывают значения к дефолтам', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await page.locator('#mWeight').fill('100');
        await page.locator('#mSets').fill('6');
        await page.locator('#mReps').fill('8-10');
        await page.locator('[data-act="wClr"]').click();
        await expect(page.locator('#mWeight')).toHaveValue('0');
        await page.locator('[data-act="sClr"]').click();
        await expect(page.locator('#mSets')).toHaveValue('1');
        await page.locator('[data-act="rClr"]').click();
        await expect(page.locator('#mReps')).toHaveValue('');
        /* после очистки значение вводится заново и сохраняется */
        await page.locator('[data-act="wAdd"][data-a="50"]').click();
        await page.locator('[data-act="setsSet"][data-a="3"]').click();
        await page.locator('[data-act="repsSet"][data-a="10"]').click();
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await openActiveDetail(page);
        await expect(page.locator('.expill .entry').first()).toContainText('50 кг, 3 подхода по 10 повторений', { timeout: 5000 });
    });

    test('переименование тренировки не трогает упражнения', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await page.locator('#mWeight').fill('100');
        await page.locator('[data-act="setsSet"][data-a="3"]').click();
        await page.locator('[data-act="repsSet"][data-a="10"]').click();
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await openActiveDetail(page);

        /* второе и третье упражнения — чтобы в превью было ровно 3 строки упражнений */
        await page.locator('[data-act="openPicker"]').click();
        await page.locator('.modal.open .excard', { hasText: 'Подтягивания' }).first().click();
        await page.locator('[data-act="repsSet"][data-a="10"]').click();
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await page.locator('[data-act="openPicker"]').click();
        await page.locator('.modal.open .excard', { hasText: 'Жим ногами' }).first().click();
        await page.locator('[data-act="repsSet"][data-a="12"]').click();
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await openActiveDetail(page);

        /* тап по названию тренировки -> окно названия тренировки -> сохраняем «Спина» */
        await page.locator('.wctitles').click();
        await expect(page.locator('#mTitle')).toBeVisible({ timeout: 5000 });
        await page.locator('#mTitle').fill('Спина');
        await page.locator('[data-act="saveTitle"]').click();
        await expect(page.locator('.wctitles .t1', { hasText: 'Спина' })).toBeVisible({ timeout: 5000 });

        /* название тренировки НЕ попало в упражнения */
        await expect(page.locator('.expill .exname', { hasText: 'Спина' })).toHaveCount(0, { timeout: 5000 });
        await expect(page.locator('.expill .exname', { hasText: EX })).toBeVisible({ timeout: 5000 });

        /* и после перезагрузки: title = Спина, упражнения на месте */
        await page.reload();
        await openActiveDetail(page);
        await expect(page.locator('.wctitles .t1', { hasText: 'Спина' })).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.expill .exname', { hasText: 'Спина' })).toHaveCount(0, { timeout: 5000 });
        await expect(page.locator('.expill .exname', { hasText: EX })).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.expill .entry').first()).toContainText('100 кг', { timeout: 5000 });

        /* все 3 упражнения видны в превью несмотря на своё название */
        await page.locator('.nav button', { hasText: 'История' }).click();
        await expect(page.locator('.pcard').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.pc-date', { hasText: 'Спина' }).first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.pc-ex', { hasText: 'Жим штанги лёжа' }).first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.pc-ex', { hasText: 'Подтягивания' }).first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.pc-ex', { hasText: 'Жим ногами' }).first()).toBeVisible({ timeout: 5000 });
    });

    test('математика объёма: среднее по диапазону, макс, ккал от объёма', async ({ page }) => {
        await openApp(page);
        const r = await page.evaluate(function () {
            const g = window.__gym;
            const p = { sex: 'м', age: 30, height: 180, weight: 90 };
            const w60 = { started: '2026-10-29T09:30:00', ended: '2026-10-29T10:30:00', finished: true,
                exercises: [{ name: 'Жим штанги лёжа', sets: [{ w: '75-175', s: 3, r: '8-10' }] }] };
            return {
                avgWeight: g.avgNum('75-175'),
                repsRange: g.repsAvg('8-10'),
                repsMax: g.repsAvg('макс'),
                repsPlus: g.repsAvg('5+1'),
                volume: g.workoutVolume(w60),
                calc: g.calcWorkoutKcal(p, w60)
            };
        });
        if (r.avgWeight !== 125) throw new Error('среднее 75-175: ' + r.avgWeight);
        if (r.repsRange !== 9) throw new Error('среднее 8-10: ' + r.repsRange);
        if (r.repsMax !== 10) throw new Error('макс = 10: ' + r.repsMax);
        if (r.repsPlus !== 6) throw new Error('5+1 = 6: ' + r.repsPlus);
        /* объём: 125 × 3 подхода × 9 повторений = 3375 */
        if (r.volume !== 3375) throw new Error('объём: ' + r.volume);
        if (!r.calc || !r.calc.total) throw new Error('ккал не посчитались');
        /* 3375 кг / 60 мин = 56 кг/мин < 120 → MET 3.5 → 3.5×3.5×90÷200×60 ≈ 331 */
        if (r.calc.total < 300 || r.calc.total > 360) throw new Error('ккал вне диапазона: ' + r.calc.total);
    });

    test('вес с буквами отклоняется', async ({ page }) => {
        page.on('console', function (msg) { if (msg.text().indexOf('[SE]') === 0) console.log('SE:', msg.text()); });
        await openApp(page);
        await startAndPick(page, EX);
        await page.locator('#mWeight').fill('50 кг');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.toast.err')).toBeVisible({ timeout: 5000 });
        await page.locator('#mWeight').fill('abc');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).toBeVisible({ timeout: 5000 });
        /* теперь корректный ввод сохраняется */
        await page.locator('#mWeight').fill('75-175');
        await page.locator('[data-act="setsSet"][data-a="1"]').click();
        await page.locator('[data-act="repsSet"][data-a="8"]').click();
        const dbg = await page.evaluate(function () {
            return {
                w: document.getElementById('mWeight').value,
                s: document.getElementById('mSets').value,
                r: document.getElementById('mReps').value,
                ctx: window.__gym.modalCtx(),
                toast: (document.getElementById('toast') || { textContent: '' }).textContent
            };
        });
        console.log('DBG STATE:', JSON.stringify(dbg));
        await page.locator('[data-act="saveEntry"]').click();
        await page.waitForTimeout(2000);
        const dbg2 = await page.evaluate(function () {
            return {
                modal: document.getElementById('modal').className,
                ctx: window.__gym.modalCtx(),
                toast: (document.getElementById('toast') || { textContent: '' }).textContent
            };
        });
        console.log('DBG AFTER:', JSON.stringify(dbg2));
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await openActiveDetail(page);
        await expect(page.locator('.expill .entry').first()).toContainText('75-175 кг, 1 подход по 8 повторений', { timeout: 5000 });
    });


    test('выбранная тема сохраняется после перезагрузки', async ({ page, request }) => {
        await openApp(page);
        await page.locator('.topbar .tb-user').click();
        await page.locator('.themecard', { hasText: 'Stockline' }).click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'stockline', { timeout: 5000 });
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'stockline', { timeout: 5000 });
    });

    test('id удалённой тренировки не переиспользуется (tombstone-защита от коллизий)', async ({ page, request }) => {
        /* сервер: тренировка id 5 жива, id 3 удалена, nextId=6 (клиент мог прислать устаревший) */
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 5, del: [3],
            profile: { sex: 'м', age: 30, height: 180, weight: 90 },
            workouts: [{ id: 5, date: '2026-10-29', started: '2026-10-29T09:30:00', ended: '2026-10-29T10:30:00',
                finished: true, title: '', nutrition: '',
                exercises: [{ name: EX, st: '2026-10-29T09:31:00', en: '2026-10-29T10:00:00',
                    sets: [{ w: '100', s: 3, r: '8-10', t: '2026-10-29T09:32:00' }] }] }]
        } } });
        await openApp(page);
        await startWorkoutUi(page);
        const st = await request.get('/api/state');
        const state = await st.json().catch(function () { return null; });
        if (!state || !Array.isArray(state.workouts)) throw new Error('нет состояния заглушки');
        if (state.workouts.some(function (w) { return w.id === 3; })) throw new Error('tombstone id 3 воскрес!');
        const fresh = state.workouts.find(function (w) { return !w.finished; });
        if (!fresh) throw new Error('новая тренировка не создана');
        if (fresh.id !== 6) throw new Error('новая тренировка получила id ' + fresh.id + ', ожидался 6');
    });

    test('повторный «Начать тренировку» не создаёт дубликат', async ({ page, request }) => {
        await openApp(page);
        await startWorkoutUi(page);
        /* после старта мы на экране редактирования — возвращаемся на Главный и жмём «Начать» ещё раз */
        await page.locator('.nav button', { hasText: 'Тренировка' }).click();
        await page.locator('[data-act="startWorkout"]').click();
        await expect(page.locator('.modal.open')).toBeVisible({ timeout: 5000 });
        await page.locator('.modal.open [data-act="closeModal"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        const st = await request.get('/api/state');
        const state = await st.json().catch(function () { return null; });
        if (!state || !Array.isArray(state.workouts)) throw new Error('нет состояния заглушки');
        const unfin = state.workouts.filter(function (w) { return !w.finished; });
        if (unfin.length !== 1) throw new Error('незавершённых тренировок: ' + unfin.length + ', ожидалась 1');
    });
});

/* ===== мобильная эмуляция: тач + настоящая клавиатура (Android/iOS) ===== */
test.describe('мобильный (тач-экран)', function () {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    async function touchTap(page, loc) {
        const b = await loc.boundingBox();
        await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    }

    test('поиск: тап в поле не закрывает модалку, фокус есть, ввод фильтрует', async ({ page }) => {
        await openApp(page);
        await startWorkoutUi(page);
        await openActiveDetail(page);
        await touchTap(page, page.locator('[data-act="openPicker"]'));
        await expect(page.locator('.modal.open')).toBeVisible({ timeout: 5000 });

        const q = page.locator('#pickerQ');
        await touchTap(page, q);
        await expect(page.locator('.modal.open')).toBeVisible({ timeout: 5000 });
        const focused = await q.evaluate(function (el) { return el === document.activeElement; });
        if (!focused) throw new Error('тап не поставил фокус в поле поиска');

        await page.keyboard.type('жим', { delay: 120 });
        await expect(page.locator('#pickerList .excard', { hasText: 'Жим штанги лёжа' }).first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#pickerList .excard', { hasText: 'Подтягивания' })).toHaveCount(0);
    });

    test('полный флоу с тача: старт, вес с клавиатуры, запись сохраняется', async ({ page }) => {
        await openApp(page);
        await touchTap(page, page.locator('[data-act="startWorkout"]'));
        const modal = page.locator('.modal.open');
        await modal.waitFor({ state: 'visible', timeout: 5000 });
        await touchTap(page, modal.locator('.excard', { hasText: EX }).first());
        await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 });
        await touchTap(page, modal.locator('#mWeight'));
        await page.keyboard.type('100');
        await touchTap(page, modal.locator('#mSets'));
        await page.keyboard.type('3');
        await touchTap(page, modal.locator('#mReps'));
        await page.keyboard.type('8-10');
        await touchTap(page, modal.locator('[data-act="saveEntry"]'));
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await openActiveDetail(page);
        await expect(page.locator('.expill .entry').first()).toContainText('100 кг, 3 подхода по 8-10 повторений', { timeout: 5000 });
        await page.reload();
        await expect(page.locator('#app .hero')).toBeVisible({ timeout: 10000 });
        await openActiveDetail(page);
        await expect(page.locator('.expill .entry').first()).toContainText('100 кг, 3 подхода по 8-10 повторений', { timeout: 5000 });
    });
});
