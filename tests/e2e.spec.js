const { test, expect } = require('@playwright/test');
const http = require('http');

const EX = 'Жим штанги лёжа';

test.beforeEach(async function ({ request }) {
    await request.post('/api/reset');
});

/* захват тестового крюка приложения до загрузки app.js.
   [ONB] флаги онбординга ставятся ДО загрузки: приветствие/туториал/«Что нового»
   не должны мешать существующим сценариям. Тесты самого онбординга сбрасывают
   флаги вторым addInitScript (localStorage.clear) в начале каждого */
test.beforeEach(async function ({ context }) {
    await context.addInitScript(function () {
        window.__gymExpose = function (api) { window.__gym = api; };
        try {
            localStorage.setItem('gymOnbDone', '1');
            localStorage.setItem('gymWnOff', '1');
            localStorage.setItem('gymHelpSeen', '1');
        } catch (e) { /* noop */ }
    });
});


async function openApp(page) {
    await page.goto('/');
    await expect(page.locator('#app .hero, #app .pcard').first()).toBeVisible({ timeout: 10000 });
}
async function startAndPick(page, name) {
    await page.locator('.nav .nfab').click();
    const modal = page.locator('.modal.open');
    await modal.waitFor({ state: 'visible', timeout: 5000 });
    /* [UX-T30] дефолт пикера — «★ Любимые»; для выбора из каталога переключаемся на «Все» */
    await modal.locator('.secrow .chip', { hasText: 'Все' }).first().click();
    await modal.locator('.excard', { hasText: name }).first().click();
    await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 });
}
/* активная тренировка в истории свёрнута в стеклянную превью-карточку — тап открывает её карточку */
async function startWorkoutUi(page) {
    await page.locator('.nav .nfab').click();
    await expect(page.locator('.modal.open')).toBeVisible({ timeout: 5000 });
    /* [UX-T18] в пикере две кнопки закрытия (✕ в шапке + «Закрыть» внизу) */
    await page.locator('.modal.open [data-act="closeModal"]').first().click();
    await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
}
async function openActiveDetail(page) {
    if (await page.locator('.expill').first().isVisible().catch(function () { return false; })) return;
    /* уже внутри карточки (после старта попадаем сразу сюда) */
    if (await page.locator('.backbar').isVisible().catch(function () { return false; })) return;
    await page.locator('.pcard').first().click();
    await expect(page.locator('.wcicons').first()).toBeVisible({ timeout: 5000 });
}
function isoDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
/* завершённая тренировка с одним упражнением и одним подходом */
function doneWorkout(id, day, name, w, sets) {
    return { id: id, date: day, started: day + 'T09:30:00', ended: day + 'T10:30:00', finished: true, title: '', nutrition: '',
        exercises: [{ name: name, st: day + 'T09:31:00', en: day + 'T10:00:00',
            sets: [{ w: w, s: sets, r: '8-10', t: day + 'T09:32:00' }] }] };
}

test.describe('GymHelper e2e', function () {

    test('старт: пикер открывается сразу после начала тренировки', async ({ page }) => {
        await openApp(page);
        await page.locator('.nav .nfab').click();
        /* после старта — сразу экран редактирования (карточка тренировки), а не Главный */
        await expect(page.locator('.modal.open')).toBeVisible({ timeout: 5000 });
        await page.locator('.modal.open [data-act="closeModal"]').first().click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await expect(page.locator('.wcpill')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.backbar', { hasText: 'Завершить' })).toBeVisible({ timeout: 5000 });

        await openActiveDetail(page);
        await page.locator('[data-act="openPicker"]').click();
        /* [UX-T30] дефолт — «★ Любимые»; выбираем из каталога через «Все» */
        await page.locator('.modal.open .secrow .chip', { hasText: 'Все' }).first().click();
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
        /* [UX-B9] позитивный путь: успешное сохранение записи подтверждается тостом */
        await expect(page.locator('.toast.show')).toHaveText('✓ Сохранено', { timeout: 5000 });

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

    test('удаление записи: 🗑-иконка в шапке модалки', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await page.locator('#mWeight').fill('100');
        await page.locator('#mSets').fill('3');
        await page.locator('#mReps').fill('8-10');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible();

        await openActiveDetail(page);
        await page.locator('.expill .entry').click();
        /* [UX-T23] «🗑 Удалить» — иконка в правом углу заголовка (mtitle-row) */
        const del = page.locator('.modal.open .mtitle-row [data-act="deleteEntry"]');
        await expect(del).toHaveCount(1);
        await del.click();
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

    test('[UX-T14] drag упражнений: порядок меняется, сохраняется на сервере, тап по плитке работает', async ({ page, request }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await fillEntry(page, '100', '3', '10');
        await openActiveDetail(page);
        await page.locator('[data-act="openPicker"]').click();
        /* [UX-T30] дефолт — «★ Любимые»; для каталога — «Все» */
        await page.locator('.modal.open .secrow .chip', { hasText: 'Все' }).first().click();
        await page.locator('.modal.open .excard', { hasText: 'Подтягивания' }).first().click();
        await page.locator('#mReps').fill('8');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await openActiveDetail(page);
        await expect(page.locator('.expill')).toHaveCount(2);
        const names = page.locator('.expill .exname');
        await expect(names.nth(0)).toHaveText(EX);
        await expect(names.nth(1)).toHaveText('Подтягивания');

        /* [UX-T22] ручки ⠿ больше нет: программный drag long-press (650 мс) по плитке —
            вниз на место второй */
        const src = await page.locator('.expill .exname').first().boundingBox();
        const target = await page.locator('.expill').nth(1).boundingBox();
        if (!src || !target) throw new Error('плитка не найдена');
        const cx = src.x + src.width / 2, y0 = src.y + src.height / 2, y1 = target.y + target.height / 2;
        await page.mouse.move(cx, y0);
        await page.mouse.down();
        await page.waitForTimeout(800); /* long-press 650 мс: подъём плитки до первого move */
        for (let i = 1; i <= 6; i++) {
            await page.mouse.move(cx, y0 + (y1 - y0) * i / 6);
            await page.waitForTimeout(40);
        }
        await page.mouse.up();
        await expect(names.nth(0)).toHaveText('Подтягивания', { timeout: 5000 });
        await expect(names.nth(1)).toHaveText(EX, { timeout: 5000 });

        /* порядок переживает перезагрузку — сохранён на сервере */
        await page.reload();
        await openActiveDetail(page);
        await expect(page.locator('.expill .exname').nth(0)).toHaveText('Подтягивания', { timeout: 10000 });
        await expect(page.locator('.expill .exname').nth(1)).toHaveText(EX, { timeout: 5000 });

        /* тап по плитке по-прежнему открывает упражнение (переименование) */
        await page.locator('.expill .exname').nth(1).click();
        await expect(page.locator('#mName')).toBeVisible({ timeout: 5000 });
        await page.locator('[data-act="closeModal"]').click();

        /* на сервере массив exercises переставлен, записи (sets) не тронуты */
        const st = await (await request.get('/api/state')).json();
        const act = (st.workouts || []).filter(function (w) { return !w.finished; })[0];
        if (!act || (act.exercises || []).length !== 2) throw new Error('упражнения не сохранились: ' + JSON.stringify(act));
        if (act.exercises[0].name !== 'Подтягивания' || act.exercises[1].name !== EX) {
            throw new Error('порядок на сервере неверен: ' + JSON.stringify(act.exercises.map(function (e) { return e.name; })));
        }
        const bench = act.exercises[1];
        if (!bench.sets || bench.sets.length !== 1 || bench.sets[0].w !== '100' || bench.sets[0].s !== 3) {
            throw new Error('записи упражнения потерялись при перестановке: ' + JSON.stringify(bench));
        }
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

    test('завершение тренировки: остаёмся в карточке с картой мышц, Назад → история', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await page.locator('#mWeight').fill('100');
        await page.locator('#mSets').fill('3');
        await page.locator('#mReps').fill('8-10');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });

        await openActiveDetail(page);
        /* [UX-T22] завершение — из нижней кнопки backbar (✓ из шапки убрана) */
        await page.locator('.backbar [data-act="finishWorkout"]').click();
        /* [FIT-T1] решение владельца 23.11 (1-А, меняет [UX-T13]): после завершения
           остаёмся в открытой карточке — блок карты мышц виден сразу */
        await expect(page.locator('.toast.show')).toHaveText('✅ Тренировка завершена', { timeout: 5000 });
        await expect(page.locator('.mapcard')).toBeVisible({ timeout: 5000 });
        /* backbar переключился на завершённый набор 🗑/↻/← */
        await expect(page.locator('.backbar', { hasText: 'Повторить' })).toBeVisible({ timeout: 5000 });
        /* «← Назад» ведёт в историю как раньше: превью без пилюли «⚫ идёт» */
        await page.locator('.backbar [data-act="closeHistory"]').click();
        await expect(page.locator('.pcard').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.pc-date')).toContainText('.', { timeout: 5000 });
        await expect(page.locator('.pc-pill')).toHaveCount(0);
    });

    test('удаление тренировки с подтверждением', async ({ page }) => {
        await openApp(page);
        await startWorkoutUi(page);
        await openActiveDetail(page);
        /* [UX-T22] 🗑 из шапки активной убрана: удаление — нижняя кнопка backbar */
        await page.locator('.backbar [data-act="confirmModal"]').click();
        await page.locator('.modal.open [data-act="confirmYes"]').click();
        /* пустая история: hero-карточка старта вместо превью */
        await expect(page.locator('#app .hero', { hasText: 'Пока пусто' })).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.pcard')).toHaveCount(0);
    });

    test('[UX-T22/T23/T35] активная карточка: шапка 1 иконка (⏱), backbar Удалить/Завершить/Назад, пилюля подхода и автосейв-выход', async ({ page, request }) => {
        await openApp(page);
        await startWorkoutUi(page);
        await openActiveDetail(page);
        /* [UX-T23] шапка активной — ровно 1 иконка ⏱ Время (←/➕/✕/✓/🗑 убраны) */
        const headActs = await page.locator('.wcicons .barebtn').evaluateAll(function (els) {
            return els.map(function (el) { return el.getAttribute('data-act'); });
        });
        if (JSON.stringify(headActs) !== JSON.stringify(['timeModal'])) {
            throw new Error('иконки шапки активной: ' + JSON.stringify(headActs) + ', ожидалось [timeModal]');
        }
        for (const label of ['Назад', 'Добавить упражнение', 'Отменить тренировку', 'Завершить тренировку', 'Удалить']) {
            await expect(page.locator('.wcicons .barebtn[aria-label="' + label + '"]')).toHaveCount(0);
        }
        /* нижний ряд: 🗑 Удалить (confirm) → ✓ Завершить (жёлтая prime) → ← Назад (автосейв) */
        const bbActs = await page.locator('.backbar .btn').evaluateAll(function (els) {
            return els.map(function (el) { return el.getAttribute('data-act'); });
        });
        if (JSON.stringify(bbActs) !== JSON.stringify(['confirmModal', 'finishWorkout', 'closeHistory'])) {
            throw new Error('кнопки backbar: ' + JSON.stringify(bbActs) + ', ожидалось [confirmModal, finishWorkout, closeHistory]');
        }
        const finishBtn = page.locator('.backbar [data-act="finishWorkout"]');
        await expect(finishBtn).toHaveClass(/prime/);
        await expect(finishBtn).toContainText('Завершить');
        await expect(page.locator('.backbar [data-act="confirmModal"]')).toContainText('Удалить');
        await expect(page.locator('.backbar [data-act="closeHistory"]')).toContainText('Назад');
        /* «➕ Добавить упражнение» — единственная широкая кнопка в потоке карточки */
        const addBtn = page.locator('.card [data-act="openPicker"]');
        await expect(addBtn).toHaveCount(1);
        await expect(addBtn).toContainText('Добавить упражнение');
        await expect(addBtn).toHaveClass(/wide/);
        /* пилюля «Добавить подход» появляется под записями вместе с упражнением; кнопки под сетами нет */
        await addBtn.click();
        await page.locator('.modal.open .secrow .chip', { hasText: 'Все' }).first().click(); /* [UX-T30] дефолт «★ Любимые» */
        await page.locator('.modal.open .excard', { hasText: EX }).first().click();
        await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 });
        await page.locator('#mWeight').fill('100');
        await page.locator('#mSets').fill('3');
        await page.locator('#mReps').fill('8-10');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await expect(page.locator('.expill .ex-addset[data-act="openEntryModal"]')).toHaveCount(1);
        await expect(page.locator('.expill .ex-addset[aria-label="Добавить подход"]')).toHaveCount(1);
        await expect(page.locator('.expill .btnrow')).toHaveCount(0);
        /* [UX-T22] dirty-модалки нет: выход через нижний «← Назад» тихо автосохраняет */
        await page.locator('.backbar [data-act="closeHistory"]').click();
        await expect(page.locator('.modal.open')).toHaveCount(0); /* без «выйти без сохранения?» */
        await expect(page.locator('.pcard').first()).toBeVisible({ timeout: 5000 });
        /* автосейв доехал до сервера */
        const st = await (await request.get('/api/state')).json();
        const act = (st.workouts || []).filter(function (w) { return !w.finished; })[0];
        if (!act || !(act.exercises || []).length || !(act.exercises[0].sets || []).length) {
            throw new Error('автосохранение при выходе не дошло до сервера: ' + JSON.stringify(act));
        }
        /* карточка снова открывается, шапка всё ещё 1 иконка */
        await openActiveDetail(page);
        await expect(page.locator('.wcicons .barebtn')).toHaveCount(1);
    });

    test('[UX-T22] «Добавить упражнение» стоит перед «Ккал по упражнениям»; у завершённой плюсиков нет', async ({ page, request }) => {
        const today = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            profile: { sex: 'м', age: 30, height: 180, weight: 90 },
            workouts: [
                { id: 1, date: today, started: today + 'T18:00:00', ended: '', finished: false, title: '', nutrition: '',
                    exercises: [{ name: EX, st: today + 'T18:01:00', en: '', sets: [{ w: '100', s: 3, r: '8-10', t: today + 'T18:02:00' }] }] },
                doneWorkout(2, today, 'Подтягивания', '0', 4)
            ]
        } } });
        await openApp(page);
        /* активная превью-карточка первая (список: активная сверху) */
        await page.locator('.pcard').first().click();
        await expect(page.locator('.wcicons').first()).toBeVisible({ timeout: 5000 });
        /* структурный порядок внутри карточки: btnrow с «Добавить упражнение» раньше details «Ккал» */
        const order = await page.locator('.card').evaluate(function (card) {
            const kids = Array.prototype.slice.call(card.children);
            const idx = function (pred) { return kids.findIndex(pred); };
            return {
                add: idx(function (el) { return el.classList.contains('btnrow') && el.querySelector('[data-act="openPicker"]'); }),
                kcal: idx(function (el) { return el.tagName === 'DETAILS' && el.textContent.indexOf('Ккал') >= 0; })
            };
        });
        if (order.add < 0 || order.kcal < 0 || order.add > order.kcal) {
            throw new Error('«Добавить упражнение» не перед «Ккал»: ' + JSON.stringify(order));
        }
        /* завершённая карточка: пилюли «Добавить подход» и широкой кнопки добавления нет [UX-B6] */
        await page.locator('.backbar [data-act="closeHistory"]').click();
        await expect(page.locator('.pcard').nth(1)).toBeVisible({ timeout: 5000 });
        await page.locator('.pcard').nth(1).click();
        await expect(page.locator('.wcicons').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.card [data-act="openPicker"]')).toHaveCount(0);
        await expect(page.locator('.expill .ex-addset[data-act="openEntryModal"]')).toHaveCount(0);
    });

    test('[UX-T35] пилюля «Добавить подход» у каждой плитки; пустая плитка — пилюля единственная и открывает модалку', async ({ page, request }) => {
        const today = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 1, del: [],
            workouts: [{ id: 1, date: today, started: today + 'T18:00:00', ended: '', finished: false, title: '', nutrition: '',
                exercises: [
                    { name: EX, st: today + 'T18:01:00', en: '', sets: [{ w: '100', s: 3, r: '8-10', t: today + 'T18:02:00' }] },
                    { name: 'Подтягивания', st: today + 'T18:03:00', en: '', sets: [] }
                ] }]
        } } });
        await openApp(page);
        await page.locator('.pcard').first().click();
        await expect(page.locator('.wcicons').first()).toBeVisible({ timeout: 5000 });
        /* пилюля у КАЖДОЙ плитки активной тренировки (паритет со старым «+») */
        await expect(page.locator('.expill .ex-addset')).toHaveCount(2);
        /* пустая плитка (0 подходов): пилюля — единственный элемент под шапкой, без плейсхолдера */
        const empty = page.locator('.expill').nth(1);
        await expect(empty.locator('.entry')).toHaveCount(0);
        await expect(empty.locator('.ex-addset')).toHaveCount(1);
        /* тап по пилюле пустой плитки — модалка «Новая запись» (путь первого подхода не удлинился) */
        await empty.locator('.ex-addset').click();
        await expect(page.locator('.modal.open')).toBeVisible({ timeout: 5000 });
        await page.locator('[data-act="closeModal"]').click();
        await expect(page.locator('.modal.open')).toHaveCount(0);
    });

    test('[UX-T17] «⭐ Любимые упражнения» в Профиле: переход на «Технику» с фильтром «★ Любимые»', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await page.locator('[data-act="closeModal"]').first().click();
        /* отмечаем жим ⭐ в пикере (дефолт «★ Любимые» [UX-T30] → для каталога «Все») */
        await page.locator('[data-act="openPicker"]').click();
        await page.locator('.modal.open .secrow .chip', { hasText: 'Все' }).first().click();
        await page.locator('.modal.open .excard', { hasText: EX }).first().locator('.star').click();
        await expect(page.locator('.modal.open .excard', { hasText: EX }).first().locator('.star')).toHaveClass(/fav/, { timeout: 5000 });
        await page.locator('[data-act="closeModal"]').first().click();
        /* Профиль → кнопка любимых */
        await page.locator('.nav button', { hasText: 'Профиль' }).click();
        const card = page.locator('.card', { hasText: '⭐ Любимые упражнения' });
        await expect(card.locator('[data-act="openFavs"]')).toBeVisible({ timeout: 5000 });
        await card.locator('[data-act="openFavs"]').click();
        /* вкладка «Техника», чип «★ Любимые» активен, в списке — только любимое */
        await expect(page.locator('.tb-title')).toContainText('Техника', { timeout: 5000 });
        await expect(page.locator('.card .secrow .chip', { hasText: '★ Любимые' })).toHaveClass(/on/, { timeout: 5000 });
        await expect(page.locator('#techList .excard', { hasText: EX })).toHaveCount(1);
        await expect(page.locator('#techList .excard', { hasText: 'Подтягивания' })).toHaveCount(0);
    });

    test('фильтры каталога в пикере [EXR-T4 fix]: «Инвентарь» вместо «Блок», «Вид» удалена', async ({ page }) => {
        await openApp(page);
        await startWorkoutUi(page);
        await openActiveDetail(page);
        await page.locator('[data-act="openPicker"]').click();
        const modal = page.locator('.modal.open');
        /* секции пикера: «Вид» отменена владельцем, вместо «Блок» — «Инвентарь» [EXR-T4] */
        const sections = await modal.locator('#pickerSections .chip').allTextContents();
        if (sections.indexOf('Вид') !== -1) throw new Error('секция «Вид» должна быть удалена: ' + JSON.stringify(sections));
        if (sections.indexOf('Инвентарь') === -1) throw new Error('нет секции «Инвентарь»: ' + JSON.stringify(sections));
        await modal.locator('#pickerSections .chip', { hasText: 'Инвентарь' }).click();
        await expect(modal.locator('#pickerCats .chip', { hasText: 'Штанга' })).toBeVisible({ timeout: 5000 });
        await modal.locator('#pickerCats .chip', { hasText: 'Штанга' }).click();
        await expect(page.locator('#pickerList .excard', { hasText: 'Жим штанги лёжа' }).first()).toBeVisible({ timeout: 5000 });
    });

    test('навигация по вкладкам, тренер и настройки', async ({ page }) => {
        await openApp(page);
        for (const label of ['Статистика', 'Техника']) {
            await page.locator('.nav button', { hasText: label }).click();
            await expect(page.locator('.tb-title')).toContainText(label, { timeout: 5000 });
        }
        /* [UX-T27] шестерёнка открывает Настройки */
        await page.locator('[aria-label="Настройки"]').click();
        await expect(page.locator('.tb-title')).toContainText('Настройки', { timeout: 5000 });
        /* [UX-S4] тогл темы: ровно один role=switch «Тёмная тема» */
        await expect(page.locator('[role="switch"][aria-label="Тёмная тема"]')).toHaveCount(1);
        /* раздел «Тренер» доступен из настроек: switchTab закрывает Настройки [UX-S4 §12.9] */
        await page.locator('#app button', { hasText: 'Открыть раздел' }).click();
        await expect(page.locator('.tb-title')).toContainText('Тренер', { timeout: 5000 });
    });

    test('[ONB-T2] Настройки: пункт «Политика конфиденциальности», /privacy.html отдаётся со статусом 200', async ({ page }) => {
        await openApp(page);
        await page.locator('[aria-label="Настройки"]').click();
        await expect(page.locator('.tb-title')).toContainText('Настройки', { timeout: 5000 });
        /* резервный блок [UX-S4] расскомментирован: кнопка политики видима в Настройках */
        await expect(page.locator('#app button', { hasText: 'Политика конфиденциальности' })).toBeVisible({ timeout: 5000 });
        /* статичная страница политики отдаётся тестовым сервером */
        const resp = await page.request.get('/privacy.html');
        if (resp.status() !== 200) throw new Error('privacy.html: HTTP ' + resp.status());
        const body = await resp.text();
        if (!body.includes('Политика конфиденциальности')) throw new Error('privacy.html без заголовка политики');
    });

    /* [ONB-T2] регресс блокер-фикса 488c110: вкладка открыта в момент /delete_my_data из бота —
       её save получает 409 {ok:false, rev:0} (сервер пуст). Клиент НЕ сохраняет старые данные
       поверх удаления: тост «Данные были удалены — приложение обновлено» + тихий ре-init с
       сервера (adoptServer, локальные «удалённые» тренировки не восстанавливаются) —
       вкладка опустевает сама, серверное состояние остаётся пустым */
    test('[ONB-T2] 409 на save из открытой вкладки после /delete_my_data: тост и опустевший UI (488c110)', async ({ page, request }) => {
        const today = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            profile: { sex: 'м', age: 30, height: 180, weight: 90 },
            workouts: [{ id: 1, date: today, started: today + 'T18:00:00', ended: '', finished: false, title: '', nutrition: '',
                exercises: [{ name: EX, st: today + 'T18:01:00', en: '', sets: [{ w: '100', s: 3, r: '8-10', t: today + 'T18:02:00' }] }] }]
        } } });
        await openApp(page);
        await page.locator('.pcard').first().click();
        await expect(page.locator('.wcicons').first()).toBeVisible({ timeout: 5000 });
        /* запись на месте до «удаления» */
        await expect(page.locator('.expill .entry').first()).toContainText('100 кг, 3 подхода по 8-10 повторений', { timeout: 5000 });
        /* сервер удалил данные (аналог /delete_my_data: хранилище пусто, rev=0) */
        await request.post('/api/reset');
        /* каждый save от вкладки теперь отклоняется как после удаления: 409 {ok:false, rev:0} */
        await page.route('**/api/save', function (route) {
            route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, rev: 0 }) });
        });
        /* пользователь сохраняет запись — save уходит в 409 */
        await page.locator('.expill .entry').first().click();
        await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 });
        await page.locator('#mWeight').fill('110');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        /* тост про удаление (не «Ошибка сохранения» и не «✓ Сохранено») */
        await expect(page.locator('.toast.show')).toHaveText('Данные были удалены — приложение обновлено', { timeout: 5000 });
        /* UI опустел сам: открытая карточка с исчезнувшей тренировкой вывалилась в пустую историю */
        await expect(page.locator('#app .hero', { hasText: 'Пока пусто' })).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.pcard')).toHaveCount(0);
        await expect(page.locator('.expill')).toHaveCount(0);
        /* счётчик/превью не содержат старой тренировки */
        await expect(page.locator('#app')).not.toContainText('100 кг');
        /* [UX-T28] старт новой тренировки при 409: тост «Нет связи: тренировка сохранится...»
           НЕ показывается поверх тоста удаления — при conflict свой тост подавлен,
           «Данные были удалены...» уже показан doSave'ом */
        await page.locator('.nav .nfab').click();
        await expect(page.locator('.toast.show')).toHaveText('Данные были удалены — приложение обновлено', { timeout: 5000 });
        await expect(page.locator('.toast.show', { hasText: 'Нет связи' })).toHaveCount(0);
        /* stale save не воскресил данные на сервере */
        const st = await (await request.get('/api/state')).json();
        if ((st.workouts || []).length) throw new Error('stale save воскресил данные на сервере: ' + JSON.stringify(st.workouts));
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
        /* [FIT-S2] у завершённой вместо пилюли — блок карты; продолжительность 10:00–11:30 = 1 ч 30 м */
        await expect(page.locator('.mapcard')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.statgrid.map3 .sg', { hasText: 'Продолжительность' })).toContainText('1 ч 30 м', { timeout: 5000 });
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

    test('шапка карточки: название на уровне иконок; у завершённой метрики — в плитках карты мышц', async ({ page, request }) => {
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
        await expect(page.locator('#app .hero, #app .pcard').first()).toBeVisible({ timeout: 10000 });
        await page.locator('.pcard').first().click();
        await expect(page.locator('.wcicons').first()).toBeVisible({ timeout: 5000 });

        /* [FIT-S2] пилюли метрик у завершённой заменены блоком карты: три плитки
           «Продолжительность / Объём / Калории» (данные те же, вид как в референсе) */
        await expect(page.locator('.mapcard')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.mapcard .statgrid.map3 .sg')).toHaveCount(3);
        await expect(page.locator('.statgrid.map3 .sg', { hasText: 'Продолжительность' })).toContainText('1 ч');
        await expect(page.locator('.statgrid.map3 .sg', { hasText: 'Объём' })).toContainText('≈2700 кг');
        const kcalTile = page.locator('.statgrid.map3 .sg', { hasText: 'Калории' });
        await expect(kcalTile).toContainText('ккал');
        const kcalDigits = ((await kcalTile.textContent()).match(/\d+/) || ['0'])[0];
        if (+kcalDigits < 100) throw new Error('ккал подозрительно мало для часовой тренировки: ' + kcalDigits);

        /* название тренировки и иконки карандаша/часов/корзины — на одном уровне */
        const t1 = await page.locator('.wchead .t1').boundingBox();
        const icons = await page.locator('.wcicons').boundingBox();
        if (!t1 || !icons) throw new Error('шапка карточки не найдена');
        const d = Math.abs((t1.y + t1.height / 2) - (icons.y + icons.height / 2));
        if (d > 8) throw new Error('название и иконки не на одном уровне: ' + d.toFixed(1) + 'px');

        /* блок карты стоит под шапкой и выше карточек упражнений (не «проваливается») */
        const mapBox = await page.locator('.mapcard').boundingBox();
        const firstEx = await page.locator('.expill').first().boundingBox();
        if (mapBox.y < t1.y) throw new Error('блок карты выше названия');
        if (mapBox.y + mapBox.height > firstEx.y) throw new Error('блок карты провалился ниже карточки упражнения');
    });

    test('статистика: карточка рекорда периода со шкалой', async ({ page, request }) => {
        /* тренировка этого месяца (жим 100) и старая тренировка прошлого месяца
           (личный рекорд 120): [ANA-T8] дефолт пикера «Месяц», шкала % — по всей истории */
        const now = new Date();
        const weekDay = isoDate(now);
        const oldDay = isoDate(new Date(now.getFullYear(), now.getMonth() - 1, 15));
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 3, del: [],
            profile: { sex: 'м', age: 30, height: 180, weight: 90 },
            workouts: [doneWorkout(1, oldDay, EX, '120', 3), doneWorkout(2, weekDay, EX, '100', 3)]
        } } });
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Статистика' }).click();
        const card = page.locator('.reccard', { hasText: 'Рекорды месяца · ' + EX });
        await expect(card).toHaveCount(1, { timeout: 5000 });
        await expect(card.locator('.rec-num')).toContainText('100');
        await expect(card.locator('.rec-num')).toContainText('кг');
        /* шкала = % от личного рекорда за ВСЮ историю: 100 из 120 = 83% */
        await expect(card.locator('.rec-bar i')).toHaveAttribute('style', /width:\s*83%/);
        const sub = card.locator('.rec-sub');
        await expect(sub).toContainText('личный рекорд: 120 кг');
        await expect(sub).toContainText('83%');
        /* тренировки не подряд: карточка серии (даже из одного дня) не показывается */
        await expect(page.locator('.strow')).toHaveCount(0);
        /* мышечные группы периода: жим = грудь, 3 подхода */
        const mg = page.locator('.mg', { hasText: 'Грудь' });
        await expect(mg).toBeVisible({ timeout: 5000 });
        await expect(mg).toContainText('3 подх.');
        /* старые блоки на месте в компактном виде: сводка за период (дефолт «Месяц») */
        await expect(page.locator('.statgrid')).toContainText('за месяц');
        await expect(page.locator('.statgrid')).toContainText('подходов');
        await expect(page.locator('.card', { hasText: 'Тренды' })).toBeVisible();
        await expect(page.locator('.card', { hasText: 'Упражнения' })).toBeVisible();
        /* [UX-T31] рекорд периода теперь только в Статистике: карточка видна здесь,
           а в Истории больше не рендерится */
        await expect(card).toBeVisible();
        await page.locator('.nav button', { hasText: 'История' }).click();
        await expect(page.locator('.reccard')).toHaveCount(0);
        await expect(page.locator('.pcard').first()).toBeVisible();
    });

    test('статистика: серия из двух дней подряд и группы периода', async ({ page, request }) => {
        const now = new Date();
        const today = isoDate(now);
        const yesterday = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
        const DOWS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        const dow = function (iso) { const p = iso.split('-'); return DOWS[new Date(+p[0], +p[1] - 1, +p[2]).getDay()]; };
        /* muscle-группы периода (дефолт «Месяц»): в понедельник «вчера» — прошлая неделя,
           и «Подтягивания» выпадали из групп (упало 09.11.2026, пн). Фикс теста, не кода:
           подтягивания сидируем в текущем месяце всегда (в Пн — сегодня), день серии
           добирает тренировка с именем вне каталога (findCatalog → null, группы не трогает). */
        const isMonday = (now.getDay() + 6) % 7 === 0;
        /* [ANA-T8] серия ищется в пределах календарного месяца (спека §3.1): 1-го числа
           «вчера» — прошлый месяц, пару дней серии добираем «сегодня + завтра» */
        const isFirst = now.getDate() === 1;
        const day1 = isFirst ? today : yesterday;
        const day2 = isFirst ? isoDate(new Date(now.getFullYear(), now.getMonth(), 2)) : today;
        const pullDay = (isMonday || isFirst) ? today : yesterday;
        const FILLER = 'Разминка и растяжка';
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 4, del: [],
            profile: { sex: 'м', age: 30, height: 180, weight: 90 },
            workouts: [doneWorkout(1, day1, FILLER, '0', 1), doneWorkout(2, pullDay, 'Подтягивания', '0', 4), doneWorkout(3, day2, EX, '80', 4)]
        } } });
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Статистика' }).click();
        const st = page.locator('.strow');
        await expect(st).toBeVisible({ timeout: 5000 });
        /* серия по-прежнему из 2 дней; тренировок в ней 3 (filler + подтягивания + жим) */
        await expect(st.locator('b')).toContainText('Серия: 3 тренировки подряд');
        /* дни недели серии в хронологическом порядке + «самая длинная за месяц» (дефолт) */
        await expect(st).toContainText(dow(day1) + ' · ' + dow(day2) + ' — самая длинная за месяц');
        /* группы: жим = грудь, подтягивания = спина (в периоде «Месяц»), по 4 подхода */
        await expect(page.locator('.mg', { hasText: 'Грудь' })).toContainText('4 подх.', { timeout: 5000 });
        await expect(page.locator('.mg', { hasText: 'Спина' })).toContainText('4 подх.');
    });

    /* ===== [ANA-T8] пикер периода «Статистики» (docs/spec-ana-t7-periods.md) ===== */
    test('[ANA-T8] пикер периода: дефолт «Месяц», «Всё время» = вся история, Эпли вне периода', async ({ page, request }) => {
        const now = new Date();
        const today = isoDate(now);
        const firstDay = isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
        /* старая тренировка гарантированно вне текущего месяца: 15-е число 5 месяцев назад;
           durationMin у всех = 60 мин (09:30→10:30) */
        const oldDay = isoDate(new Date(now.getFullYear(), now.getMonth() - 5, 15));
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 4, del: [],
            profile: { sex: 'м', age: 30, height: 180, weight: 90 },
            workouts: [
                doneWorkout(1, today, EX, '100', 3),
                doneWorkout(2, firstDay, 'Приседания', '80', 2),
                doneWorkout(3, oldDay, EX, '120', 3)
            ]
        } } });
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Статистика' }).click();
        /* пикер виден, 6 пилюль, дефолт «Месяц» */
        const picker = page.locator('.perpicker');
        await expect(picker).toBeVisible({ timeout: 5000 });
        await expect(picker.locator('.chip')).toHaveCount(6);
        await expect(picker.locator('.chip.on')).toHaveText('Месяц');
        /* сводка за месяц: 2 тренировки (сегодня + 1-е число), средняя ≈ 1 ч, подходов 2
           (подходы считаются по записям-сетам, как и прежде) */
        const grid = page.locator('.statgrid');
        await expect(grid.locator('.sg', { hasText: 'за месяц' }).locator('b')).toHaveText('2');
        await expect(grid.locator('.sg', { hasText: 'средняя' }).locator('b')).toHaveText('≈ 1 ч');
        await expect(grid.locator('.sg', { hasText: 'подходов' }).locator('b')).toHaveText('2');
        /* Эпли — по всей истории: лучший подход 120 кг из старой тренировки */
        const epl = page.locator('.card', { hasText: 'Оценка 1ПМ · Эпли' });
        const eplBefore = (await epl.textContent()).trim();
        await expect(epl).toContainText('120');
        /* тап «Всё время»: сводка = totals по всем finished */
        await picker.locator('.chip', { hasText: 'Всё время' }).click();
        const gridAll = page.locator('.statgrid');
        await expect(gridAll.locator('.sg', { hasText: 'за всё время' }).locator('b')).toHaveText('3');
        await expect(gridAll.locator('.sg', { hasText: 'средняя' }).locator('b')).toHaveText('≈ 1 ч');
        await expect(gridAll.locator('.sg', { hasText: 'общее время' }).locator('b')).toHaveText('3 ч');
        await expect(gridAll.locator('.sg', { hasText: 'подходов' }).locator('b')).toHaveText('3');
        /* «Рекорды» теряют слово периода, топ-подход периода = 120 кг, шкала 100% */
        const recAll = page.locator('.reccard', { hasText: 'Рекорды · ' + EX });
        await expect(recAll.locator('.rec-num')).toContainText('120');
        await expect(recAll.locator('.rec-sub')).toContainText('100%');
        /* мышечные группы за всё время */
        await expect(page.locator('.card', { hasText: 'Мышечные группы · за всё время' })).toBeVisible();
        /* Эпли — вне периода: карточка не изменилась от смены пикера */
        await expect(page.locator('.card', { hasText: 'Оценка 1ПМ · Эпли' })).toHaveText(eplBefore);
        /* «3 месяца» — лейбл во всех подписях периода (решение владельца 20.11, без «квартала»);
           квартал = окт–дек: сегодня + 1-е число, старая (май) не попадает */
        await picker.locator('.chip', { hasText: '3 месяца' }).click();
        const gridQ = page.locator('.statgrid');
        await expect(gridQ.locator('.sg', { hasText: 'за 3 месяца' }).locator('b')).toHaveText('2', { timeout: 5000 });
        await expect(page.locator('.reccard', { hasText: 'Рекорды 3 месяцев · ' + EX })).toBeVisible();
        await expect(page.locator('.card', { hasText: 'Мышечные группы · эти 3 месяца' })).toBeVisible();
    });

    test('[ANA-T8] 320px: пикер в одну строку с h-скроллом; пустой период — заглушка, Эпли на месте', async ({ page, request }) => {
        /* тренировка 10 дней назад: всегда до понедельника текущей недели → период «Неделя» пуст */
        const oldDay = isoDate(new Date(Date.now() - 10 * 86400000));
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            profile: { sex: 'м', age: 30, height: 180, weight: 90 },
            workouts: [doneWorkout(1, oldDay, EX, '100', 3)]
        } } });
        await page.setViewportSize({ width: 320, height: 680 });
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Статистика' }).click();
        const picker = page.locator('.perpicker');
        await expect(picker).toBeVisible({ timeout: 5000 });
        const m = await picker.evaluate(function (el) {
            const chips = Array.from(el.querySelectorAll('.chip'));
            return {
                ox: getComputedStyle(el).overflowX,
                scroll: el.scrollWidth > el.clientWidth,
                oneLine: chips.length > 1 && chips.every(function (c) { return c.offsetTop === chips[0].offsetTop; })
            };
        });
        if (m.ox !== 'auto') throw new Error('overflow-x пикера не auto: ' + m.ox);
        if (!m.scroll) throw new Error('на 320px пилюли не скроллятся');
        if (!m.oneLine) throw new Error('пилюли переносятся на вторую строку');
        /* активная пилюля (дефолт «Месяц») в видимой области (§2.1) */
        const visible = await picker.evaluate(function (el) {
            const on = el.querySelector('.chip.on');
            return on.offsetLeft >= el.scrollLeft && on.offsetLeft + on.offsetWidth <= el.scrollLeft + el.clientWidth + 1;
        });
        if (!visible) throw new Error('активная пилюля вне видимой области');
        /* тап «Неделя»: период пуст → заглушка с названием периода, периодные блоки скрыты */
        await picker.locator('.chip', { hasText: 'Неделя' }).click();
        await expect(page.locator('.card.hero')).toContainText('За эту неделю тренировок нет');
        await expect(page.locator('.card.hero')).toContainText('Выбери другой период — вся история на месте.');
        await expect(page.locator('.perpicker .chip.on')).toHaveText('Неделя');
        await expect(page.locator('.reccard')).toHaveCount(0);
        await expect(page.locator('.statgrid')).toHaveCount(0);
        /* Эпли — вне периода: остаётся при пустом периоде */
        await expect(page.locator('.card', { hasText: 'Оценка 1ПМ · Эпли' })).toBeVisible();
    });

    test('[ANA-T8] все тренировки периода без started: ячейки «средняя» и «общее время» нет; пустой период — заглушка', async ({ page, request }) => {
        /* ретро-ввод без started/ended: durationMin = null (спека §4.1) — тренировка сегодня,
           период «Месяц» непустой во все дни календаря */
        const today = isoDate(new Date());
        const noStart = { id: 1, date: today, finished: true, title: '', nutrition: '',
            exercises: [{ name: EX, sets: [{ w: '80', s: 3, r: '8', t: today + 'T09:32:00' }] }] };
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [], profile: { sex: 'м', age: 30, height: 180, weight: 90 },
            workouts: [noStart]
        } } });
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Статистика' }).click();
        const grid = page.locator('.statgrid');
        await expect(grid).toBeVisible({ timeout: 5000 });
        await expect(grid.locator('.sg', { hasText: 'за месяц' }).locator('b')).toHaveText('1');
        /* ни одной тренировки с длительностью: «≈ средняя» нет (§4.1), «общее время» нет (totalMin=0) */
        await expect(grid.locator('.sg', { hasText: 'средняя' })).toHaveCount(0);
        await expect(grid.locator('.sg', { hasText: 'общее время' })).toHaveCount(0);
        await expect(grid.locator('.sg', { hasText: 'подходов' }).locator('b')).toHaveText('1');
        /* смена фикстуры: тренировка 10 дней назад (всегда до понедельника текущей недели) —
           «Неделя» пуста при любой дате → заглушка; Эпли остаётся (вне периода) */
        const old = isoDate(new Date(Date.now() - 10 * 86400000));
        await request.post('/api/save', { data: { initData: '', rev: 2, data: {
            nextId: 2, del: [], profile: { sex: 'м', age: 30, height: 180, weight: 90 },
            workouts: [{ id: 1, date: old, finished: true, title: '', nutrition: '',
                exercises: [{ name: EX, sets: [{ w: '80', s: 3, r: '8', t: old + 'T09:32:00' }] }] }]
        } } });
        await page.reload();
        await expect(page.locator('#app .hero, #app .pcard').first()).toBeVisible({ timeout: 10000 });
        await page.locator('.nav button', { hasText: 'Статистика' }).click();
        await page.locator('.perpicker .chip', { hasText: 'Неделя' }).click();
        await expect(page.locator('.card.hero')).toContainText('За эту неделю тренировок нет');
        await expect(page.locator('.statgrid')).toHaveCount(0);
        await expect(page.locator('.card', { hasText: 'Оценка 1ПМ · Эпли' })).toBeVisible();
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
        /* [UX-B9] при сбое сети тоста «✓ Сохранено» нет — только тост ошибки от doSave */
        const errToast = page.locator('.toast.show.err');
        await expect(errToast).toBeVisible({ timeout: 5000 });
        await expect(errToast).toContainText('Ошибка сохранения');
        await expect(page.locator('.toast.show')).not.toHaveText('✓ Сохранено');
        await openActiveDetail(page);
        await expect(page.locator('.expill .entry').first()).toBeVisible({ timeout: 5000 });

        failSave = false;
        /* [UX-T22] кнопки «💾 Сохранить» больше нет: «← Назад» тихо автосохраняет при выходе
           (без тоста успеха и без модалки), запись доезжает до сервера */
        await page.locator('.backbar [data-act="closeHistory"]').click();
        await expect(page.locator('.backbar')).not.toBeVisible({ timeout: 5000 });
        await page.reload();
        await expect(page.locator('#app .hero, #app .pcard').first()).toBeVisible({ timeout: 10000 });
        await openActiveDetail(page);
        await expect(page.locator('.expill .entry').first()).toBeVisible({ timeout: 5000 });
    });

    test('[UX-T22] сбой сети при выходе: карточка остаётся, правка не теряется, повторный выход сохраняет', async ({ page, request }) => {
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

        /* выход при сбое сети: автосейв падает (тост ошибки от doSave),
           карточка НЕ закрывается — запись на месте, правка не затёрта */
        await page.locator('.backbar [data-act="closeHistory"]').click();
        const errToast = page.locator('.toast.show.err');
        await expect(errToast).toBeVisible({ timeout: 5000 });
        await expect(errToast).toContainText('Ошибка сохранения');
        await expect(page.locator('.backbar')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.expill .entry').first()).toBeVisible({ timeout: 5000 });

        /* сеть восстановилась: повторный выход сохраняет и закрывает карточку */
        failSave = false;
        await page.waitForTimeout(500); /* дедуп клика 400 мс — ждем окно */
        await page.locator('.backbar [data-act="closeHistory"]').click();
        await expect(page.locator('.backbar')).not.toBeVisible({ timeout: 5000 });
        const st = await (await request.get('/api/state')).json();
        const act = (st.workouts || []).filter(function (w) { return !w.finished; })[0];
        if (!act || !(act.exercises || []).length || !(act.exercises[0].sets || []).length) {
            throw new Error('повторный выход не сохранил запись: ' + JSON.stringify(act));
        }
    });

    test('[UX-T22] уход с открытой карточки через нижнее меню автосохраняет', async ({ page, request }) => {
        let failSave = true;
        await page.route('**/api/save', function (route) {
            if (failSave) route.abort();
            else route.fallback();
        });
        await openApp(page);
        await startAndPick(page, EX);
        await page.locator('#mWeight').fill('90');
        await page.locator('#mSets').fill('2');
        await page.locator('#mReps').fill('10');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        /* прямой saveEntry упал (failSave) — запись пока только локально;
           переключаем вкладку нижним меню, не выходя через «Назад» */
        failSave = false;
        await page.locator('.nav button', { hasText: 'Статистика' }).click();
        await expect(page.locator('.tb-title')).toContainText('Статистика', { timeout: 5000 });
        /* фоновый автосейв switchTab доезжает до сервера */
        await expect.poll(async function () {
            const st = await (await request.get('/api/state')).json();
            const act = (st.workouts || []).filter(function (w) { return !w.finished; })[0];
            return act && act.exercises && act.exercises[0] && act.exercises[0].sets.length ? 'saved' : 'pending';
        }, { timeout: 5000 }).toBe('saved');
    });

    test('backbar активной: «← Назад» непрозрачна, видима целиком и клик закрывает карточку (#87)', async ({ page }) => {
        /* [UX-T19] backbar остался только у активной тренировки — проверка непрозрачности на ней;
           [UX-T22] прежняя «🚪 Выйти» стала «← Назад» (иконка + текст) */
        await openApp(page);
        await startWorkoutUi(page);
        await openActiveDetail(page);
        const exit = page.locator('.backbar [data-act="closeHistory"]');
        await expect(exit).toBeVisible({ timeout: 5000 });
        /* корень #87: backbar fixed и при скролле под ним проходит контент; сквозь
           полупрозрачный sec-фон тексты сливаются. Кнопка обязана быть непрозрачной (alpha > 0.5) */
        const bg = await exit.evaluate(function (el) { return getComputedStyle(el).backgroundColor; });
        const parts = String(bg).split(',');
        const alpha = parts.length > 3 ? parseFloat(parts[3]) : 1;
        if (!(alpha > 0.5)) throw new Error('«Назад» просвечивает (' + bg + ') — тексты сливаются с контентом под backbar');
        /* видима целиком в зоне backbar, клик закрывает экран карточки */
        await expect(exit).toBeInViewport({ ratio: 1 });
        await exit.click();
        await expect(page.locator('.backbar')).not.toBeVisible({ timeout: 5000 });
        await expect(page.locator('.pcard').first()).toBeVisible({ timeout: 5000 });
    });

    test('превью-карточки: дата текстом без иконки времени, жирное название, правый угол без дня недели', async ({ page }) => {
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
        /* [UX-T20] иконка времени суток из карточек убрана (рендера .dp-inline больше нет) */
        await expect(page.locator('.pcard .dp-inline')).toHaveCount(0);
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
        /* [UX-T30] дефолт пикера — «★ Любимые»: пустые избранные видны сразу, чип подсвечен, «Все» — нет */
        await expect(page.locator('.modal.open #pickerSections .chip', { hasText: '★ Любимые' })).toHaveClass(/on/, { timeout: 5000 });
        await expect(page.locator('.modal.open #pickerSections .chip', { hasText: 'Все' })).toHaveClass('chip');
        /* [EXR-T15] терминология «Любимые» + пустое состояние Э5 */
        await expect(page.locator('#pickerList')).toContainText('В Любимых пока пусто', { timeout: 5000 });
        await expect(page.locator('#pickerList .excard')).toHaveCount(0);

        await page.locator('.modal.open #pickerSections .chip', { hasText: 'Все' }).first().click();
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

    test('пикер [EXR-T4 fix]: составной «Руки» (OR бицепс/трицепс) и «Без инвентаря» не пустые', async ({ page }) => {
        await openApp(page);
        await startWorkoutUi(page);
        await openActiveDetail(page);
        await page.locator('[data-act="openPicker"]').click();
        /* «Руки» — составной айтем CATS: OR m:biceps ∨ m:triceps (+ legacy-алиас arms) */
        await page.locator('.modal.open .secrow .chip', { hasText: 'Мышцы' }).click();
        await page.locator('.modal.open #pickerCats .chip', { hasText: 'Руки' }).click();
        await expect(page.locator('#pickerList .excard', { hasText: 'Подъём штанги на бицепс' }).first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#pickerList .excard', { hasText: 'Отжимания на брусьях' }).first()).toBeVisible({ timeout: 5000 });
        /* «Без инвентаря»: e:none (+ legacy-алиасы body/home) */
        await page.locator('.modal.open .secrow .chip', { hasText: 'Инвентарь' }).click();
        await page.locator('.modal.open #pickerCats .chip', { hasText: 'Без инвентаря' }).click();
        await expect(page.locator('#pickerList .excard', { hasText: 'Отжимания от пола' }).first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#pickerList .excard', { hasText: 'Жим штанги лёжа' })).toHaveCount(0);
    });

    test('звезда добавляет в любимые', async ({ page }) => {
        await openApp(page);
        await startWorkoutUi(page);
        await openActiveDetail(page);
        await page.locator('[data-act="openPicker"]').click();
        /* [UX-T30] дефолт — «★ Любимые» (пустые); отмечаем звезду в каталоге через «Все» */
        await page.locator('.modal.open .secrow .chip', { hasText: 'Все' }).first().click();
        const card = page.locator('#pickerList .excard', { hasText: 'Жим штанги лёжа' }).first();
        await card.locator('.star').click();
        /* [EXR-T3] в каталоге есть и «Жим штанги лёжа … (Смит)» (подстрока) — берём первую карточку,
           как и в строке выше: это жим свободной штангой (bench) */
        await expect(page.locator('#pickerList .excard', { hasText: 'Жим штанги лёжа' }).first().locator('.star')).toHaveClass(/fav/, { timeout: 5000 });

        await page.locator('.modal.open .secrow .chip', { hasText: 'Любимые' }).click();
        await expect(page.locator('#pickerList .excard')).toHaveCount(1);
        await expect(page.locator('#pickerList .excard', { hasText: 'Жим штанги лёжа' })).toBeVisible();
    });

    /* ---------- [EXR-T14] модалка «✍️ Своё упражнение»: группы мышц, сервер ---------- */

    test('своё [EXR-T14]: 8 чипов групп, тогл чипов, «Отмена» возвращает в пикер с секцией', async ({ page }) => {
        await openApp(page);
        await startWorkoutUi(page);
        await openActiveDetail(page);
        await page.locator('[data-act="openPicker"]').click();
        /* секция по умолчанию «★ Любимые» — после «Отмены» она должна остаться активной */
        await page.locator('[data-act="customExerciseModal"]').click();
        await expect(page.locator('#mCustomName')).toBeVisible({ timeout: 5000 });
        const chips = page.locator('#mCustomMuscles .chip');
        await expect(chips).toHaveCount(8);
        /* бейдж «необязательно» у секции групп; подсказка под чипами */
        await expect(page.locator('.modal.open .flabel', { hasText: 'Группы мышц' })).toContainText('необязательно');
        await expect(page.locator('.modal.open .mhint')).toContainText('Можно выбрать несколько или пропустить');
        /* тап чипов вкл/выкл: 2 выбранных — янтарные */
        await chips.filter({ hasText: 'Грудь' }).click();
        await chips.filter({ hasText: 'Плечи' }).click();
        await expect(chips.filter({ hasText: 'Грудь' })).toHaveClass(/on/);
        await expect(chips.filter({ hasText: 'Плечи' })).toHaveClass(/on/);
        await chips.filter({ hasText: 'Плечи' }).click();
        await expect(chips.filter({ hasText: 'Плечи' })).toHaveClass(/chip/);
        await chips.filter({ hasText: 'Плечи' }).click();
        /* «Отмена» — возврат В ПИКЕР (не закрытие): список жив, секция «★ Любимые» активна */
        await page.locator('[data-act="backToPicker"]').click();
        await expect(page.locator('.modal.open #pickerList')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.modal.open #pickerSections .chip', { hasText: '★ Любимые' })).toHaveClass(/on/);
    });

    test('своё [EXR-T14]: создание с группами — теги #своё #chest #shoulders, переживает перезагрузку (сервер)', async ({ page }) => {
        await openApp(page);
        await startWorkoutUi(page);
        await openActiveDetail(page);
        await page.locator('[data-act="openPicker"]').click();
        await page.locator('[data-act="customExerciseModal"]').click();
        await page.locator('#mCustomName').fill('Жим Свенда стоя');
        await page.locator('#mCustomMuscles .chip', { hasText: 'Грудь' }).click();
        await page.locator('#mCustomMuscles .chip', { hasText: 'Плечи' }).click();
        await page.locator('[data-act="createCustom"]').click();
        /* после добавления — сразу окно записи нового упражнения */
        await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 });
        await page.locator('#mWeight').fill('30');
        await page.locator('#mSets').fill('3');
        await page.locator('#mReps').fill('10');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });

        await page.locator('[data-act="openPicker"]').click();
        await page.locator('.modal.open .secrow .chip', { hasText: 'Коллекции' }).click();
        await page.locator('.modal.open #pickerCats .chip', { hasText: 'Свои' }).click();
        const card = page.locator('#pickerList .excard', { hasText: 'Жим Свенда стоя' }).first();
        await expect(card).toBeVisible({ timeout: 5000 });
        await expect(card).toContainText('#своё #chest #shoulders');
        /* сервер: после перезагрузки страницы (пере-/api/init) карточка на месте */
        await page.reload();
        await openApp(page);
        await openActiveDetail(page);
        await page.locator('[data-act="openPicker"]').click();
        await page.locator('.modal.open .secrow .chip', { hasText: 'Коллекции' }).click();
        await page.locator('.modal.open #pickerCats .chip', { hasText: 'Свои' }).click();
        await expect(page.locator('#pickerList .excard', { hasText: 'Жим Свенда стоя' }).first()).toBeVisible({ timeout: 5000 });
    });

    test('своё [EXR-T14]: дубликат имени (каталог, без учёта регистра) — тост, записи нет; без групп — карточка с #своё', async ({ page }) => {
        await openApp(page);
        await startWorkoutUi(page);
        await openActiveDetail(page);
        await page.locator('[data-act="openPicker"]').click();
        await page.locator('[data-act="customExerciseModal"]').click();
        /* дубликат каталога в нижнем регистре */
        await page.locator('#mCustomName').fill('жим штанги лёжа');
        await page.locator('[data-act="createCustom"]').click();
        await expect(page.locator('.toast.show', { hasText: 'Упражнение с таким названием уже есть' })).toBeVisible({ timeout: 5000 });
        /* модалка осталась: имя правится, добавляем без групп (пауза — дедуп кнопки 400 мс) */
        await page.waitForTimeout(450);
        await page.locator('#mCustomName').fill('Фермерская прогулка');
        await page.locator('[data-act="createCustom"]').click();
        await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 });
        await page.locator('#mWeight').fill('24');
        await page.locator('#mSets').fill('2');
        await page.locator('#mReps').fill('12');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });

        await page.locator('[data-act="openPicker"]').click();
        await page.locator('.modal.open .secrow .chip', { hasText: 'Коллекции' }).click();
        await page.locator('.modal.open #pickerCats .chip', { hasText: 'Свои' }).click();
        const card = page.locator('#pickerList .excard', { hasText: 'Фермерская прогулка' }).first();
        await expect(card).toBeVisible({ timeout: 5000 });
        await expect(card).toContainText('#своё');
        await expect(card).not.toContainText('#chest');
        /* «Свои» пикера: пустое состояние до создания больше не показывается */
        await expect(page.locator('#pickerList .excard', { hasText: 'жим штанги лёжа' })).toHaveCount(0);
    });

    /* ---------- [EXR-T15] «★ Любимые»: свои в списках, фолбэк поиска ---------- */

    test('любимые [EXR-T15]: своё в «★ Любимые» пикера после каталог-фавов и в Технике (некликабельно)', async ({ page }) => {
        await openApp(page);
        await startWorkoutUi(page);
        await openActiveDetail(page);
        await page.locator('[data-act="openPicker"]').click();
        /* каталог-фав: «Подтягивания» */
        await page.locator('.modal.open .secrow .chip', { hasText: 'Все' }).first().click();
        await page.locator('#pickerList .excard', { hasText: 'Подтягивания' }).first().locator('.star').click();
        /* своё без групп + звезда на карточке в «Свои» */
        await page.locator('[data-act="customExerciseModal"]').click();
        await page.locator('#mCustomName').fill('Фермерская прогулка');
        await page.locator('[data-act="createCustom"]').click();
        await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 });
        await page.locator('#mWeight').fill('24');
        await page.locator('[data-act="closeModal"]').first().click();
        await page.locator('[data-act="openPicker"]').click();
        await page.locator('.modal.open .secrow .chip', { hasText: 'Коллекции' }).click();
        await page.locator('.modal.open #pickerCats .chip', { hasText: 'Свои' }).click();
        await page.locator('#pickerList .excard', { hasText: 'Фермерская прогулка' }).first().locator('.star').click();
        /* секция «★ Любимые»: каталог-фавы, затем свои; заголовок «★ Любимые» */
        await page.locator('.modal.open .secrow .chip', { hasText: 'Любимые' }).click();
        const grid = page.locator('#pickerList .exgrid');
        await expect(grid.locator('.excard')).toHaveCount(2);
        await expect(grid.locator('.excard').first()).toContainText('Подтягивания');
        await expect(grid.locator('.excard', { hasText: 'Фермерская прогулка' })).toBeVisible();
        await expect(page.locator('#pickerList')).toContainText('★ Любимые');

        /* Техника, чип «★ Любимые»: своё в списке, некликабельно, звезда тоглится.
           Локаторы — строго #techList: закрытый пикер остаётся в DOM (hidden-модалка) */
        await page.locator('.modal.open [data-act="closeModal"]').first().click();
        await page.locator('.nav .nbtn', { hasText: 'Техника' }).click();
        await page.locator('.card .secrow .chip', { hasText: '★ Любимые' }).click();
        const techOwn = page.locator('#techList .excard', { hasText: 'Фермерская прогулка' }).first();
        await expect(techOwn).toBeVisible({ timeout: 5000 });
        /* у карточки своего нет data-act (нет перехода в деталь) */
        const act = await techOwn.getAttribute('data-act');
        if (act) throw new Error('карточка своего в Технике должна быть некликабельной, data-act=' + act);
        await techOwn.click();
        await expect(page.locator('#techList .excard', { hasText: 'Фермерская прогулка' }).first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.exhead', { hasText: 'Техника упражнений' })).toBeVisible();
        /* тап ★ — карточка исчезает из «Любимых» без перезагрузки */
        await techOwn.locator('.star').click();
        await expect(page.locator('#techList .excard', { hasText: 'Фермерская прогулка' })).toHaveCount(0, { timeout: 5000 });
    });

    test('любимые [EXR-T15]: фолбэк «жим» — совпадения по всем (каталог + свои); тап ☆ убирает фолбэк', async ({ page }) => {
        await openApp(page);
        await startWorkoutUi(page);
        await openActiveDetail(page);
        await page.locator('[data-act="openPicker"]').click();
        /* своё «Жим Свенда стоя» (в тренировку не добавляем — закрываем окно записи) */
        await page.locator('[data-act="customExerciseModal"]').click();
        await page.locator('#mCustomName').fill('Жим Свенда стоя');
        await page.locator('[data-act="createCustom"]').click();
        await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 });
        await page.locator('[data-act="closeModal"]').first().click();
        /* каталог-фав без «жим» в названии */
        await page.locator('[data-act="openPicker"]').click();
        await page.locator('.modal.open .secrow .chip', { hasText: 'Все' }).first().click();
        await page.locator('#pickerList .excard', { hasText: 'Подтягивания' }).first().locator('.star').click();
        /* секция «★ Любимые», поиск «жим»: 0 среди избранных → фолбэк */
        await page.locator('.modal.open .secrow .chip', { hasText: 'Любимые' }).click();
        await page.locator('#pickerQ').fill('жим');
        await expect(page.locator('#pickerList .hint', { hasText: 'Не нашлось в Любимых' })).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#pickerList .hint')).toContainText('Совпадения по всем упражнениям');
        /* в выдаче каталог («Жим штанги лёжа») + свои («Жим Свенда стоя») */
        await expect(page.locator('#pickerList .excard', { hasText: 'Жим штанги лёжа' }).first()).toBeVisible();
        await expect(page.locator('#pickerList .excard', { hasText: 'Жим Свенда стоя' }).first()).toBeVisible();
        /* тап по карточке каталога в фолбэке добавляет в тренировку */
        await page.locator('#pickerList .excard', { hasText: 'Жим штанги лёжа' }).first().locator('.exn').click();
        await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 });
        await page.locator('[data-act="closeModal"]').first().click();
        /* снова пикер «★ Любимые» + «жим»: 0 среди избранных → фолбэк */
        await page.locator('[data-act="openPicker"]').click();
        await page.locator('#pickerQ').fill('жим');
        await expect(page.locator('#pickerList .hint', { hasText: 'Не нашлось в Любимых' })).toBeVisible({ timeout: 5000 });
        /* тап ☆ в фолбэке → совпадение появляется в Любимых, фолбэк исчезает */
        await page.locator('#pickerList .excard', { hasText: 'Жим Свенда стоя' }).first().locator('.star').click();
        await expect(page.locator('#pickerList .hint')).toHaveCount(0, { timeout: 5000 });
        await expect(page.locator('#pickerList .excard', { hasText: 'Жим Свенда стоя' }).first()).toBeVisible();
    });

    test('любимые [EXR-T15]: поиск без совпадений нигде — «Ничего не нашлось»', async ({ page }) => {
        await openApp(page);
        await startWorkoutUi(page);
        await openActiveDetail(page);
        await page.locator('[data-act="openPicker"]').click();
        await page.locator('#pickerQ').fill('жмаааввв');
        await expect(page.locator('#pickerList .empty', { hasText: 'Ничего не нашлось' })).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#pickerList .empty')).toContainText('✍️ Своё упражнение');
    });

    test('миграция [EXR-T14]: localStorage gymCustomEx/gymFavs → сервер, ключи очищаются; сервер приоритетен', async ({ page, request }) => {
        await page.context().addInitScript(function () {
            try {
                localStorage.setItem('gymCustomEx', JSON.stringify(['Жим Свенда стоя', 'Фермерская прогулка']));
                localStorage.setItem('gymFavs', JSON.stringify(['Фермерская прогулка', 'Подтягивания']));
            } catch (e) { /* noop */ }
        });
        await openApp(page);
        /* данные уехали на сервер (мок /api/state) */
        await expect.poll(async function () {
            const r = await request.get('/api/state');
            const j = await r.json();
            return (j.customEx || []).map(x => x.n).sort().join(',');
        }, { timeout: 8000 }).toBe('Жим Свенда стоя,Фермерская прогулка');
        await expect.poll(async function () {
            const r = await request.get('/api/state');
            const j = await r.json();
            return (j.favs || []).slice().sort().join(',');
        }, { timeout: 8000 }).toBe('Подтягивания,Фермерская прогулка');
        /* ключи localStorage очищены — теперь ПОСЛЕ подтверждённого 'ok' от doSave [EXR-T14 ревью] */
        await expect.poll(async function () {
            return await page.evaluate(function () {
                return String(localStorage.getItem('gymCustomEx')) + '|' + String(localStorage.getItem('gymFavs'));
            });
        }, { timeout: 8000 }).toBe('null|null');
        /* сценарий G.2: перезагрузка — источник сервер, дубликатов миграция не создаёт */
        await page.reload();
        await openApp(page);
        await expect.poll(async function () {
            const r = await request.get('/api/state');
            const j = await r.json();
            return (j.customEx || []).length + ':' + (j.favs || []).length;
        }, { timeout: 8000 }).toBe('2:2');
    });

    /* ---------- [EXR-T15 ревью] свои с тегами групп находятся тег-фильтрами ---------- */

    test('своё с группой находится тег-фильтром: секция «Мышцы» пикера; своё без групп — нет', async ({ page }) => {
        await openApp(page);
        await startWorkoutUi(page);
        await openActiveDetail(page);
        await page.locator('[data-act="openPicker"]').click();
        /* своё с группами (Грудь+Плечи) и своё без групп */
        await page.locator('[data-act="customExerciseModal"]').click();
        await page.locator('#mCustomName').fill('Жим Свенда стоя');
        await page.locator('#mCustomMuscles .chip', { hasText: 'Грудь' }).click();
        await page.locator('#mCustomMuscles .chip', { hasText: 'Плечи' }).click();
        await page.locator('[data-act="createCustom"]').click();
        await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 });
        await page.locator('[data-act="closeModal"]').first().click();
        await page.locator('[data-act="openPicker"]').click();
        await page.locator('[data-act="customExerciseModal"]').click();
        await page.locator('#mCustomName').fill('Фермерская прогулка');
        await page.locator('[data-act="createCustom"]').click();
        await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 });
        await page.locator('[data-act="closeModal"]').first().click();
        /* секция «Мышцы» → «Грудь»: своё с m:chest найдено, своё без тегов — не найдено */
        await page.locator('[data-act="openPicker"]').click();
        await page.locator('.modal.open .secrow .chip', { hasText: 'Мышцы' }).click();
        await page.locator('.modal.open #pickerCats .chip', { hasText: 'Грудь' }).click();
        await expect(page.locator('#pickerList .excard', { hasText: 'Жим Свенда стоя' }).first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#pickerList .excard', { hasText: 'Фермерская прогулка' })).toHaveCount(0);
    });

    test('своё с группой находится тег-фильтром в fav-секции Техники; своё без групп отсеивается', async ({ page }) => {
        await openApp(page);
        await startWorkoutUi(page);
        await openActiveDetail(page);
        await page.locator('[data-act="openPicker"]').click();
        /* создать оба своих: с группой Грудь и без групп */
        await page.locator('[data-act="customExerciseModal"]').click();
        await page.locator('#mCustomName').fill('Жим Свенда стоя');
        await page.locator('#mCustomMuscles .chip', { hasText: 'Грудь' }).click();
        await page.locator('[data-act="createCustom"]').click();
        await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 });
        await page.locator('[data-act="closeModal"]').first().click();
        await page.locator('[data-act="openPicker"]').click();
        await page.locator('[data-act="customExerciseModal"]').click();
        await page.locator('#mCustomName').fill('Фермерская прогулка');
        await page.locator('[data-act="createCustom"]').click();
        await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 });
        await page.locator('[data-act="closeModal"]').first().click();
        /* звёздить оба в «Коллекции → Свои» */
        await page.locator('[data-act="openPicker"]').click();
        await page.locator('.modal.open .secrow .chip', { hasText: 'Коллекции' }).click();
        await page.locator('.modal.open #pickerCats .chip', { hasText: 'Свои' }).click();
        await page.locator('#pickerList .excard', { hasText: 'Жим Свенда стоя' }).first().locator('.star').click();
        await page.locator('#pickerList .excard', { hasText: 'Фермерская прогулка' }).first().locator('.star').click();
        /* Техника → «★ Любимые»: оба видны без фильтров */
        await page.locator('.modal.open [data-act="closeModal"]').first().click();
        await page.locator('.nav .nbtn', { hasText: 'Техника' }).click();
        await page.locator('.card .secrow .chip', { hasText: '★ Любимые' }).click();
        await expect(page.locator('#techList .excard', { hasText: 'Жим Свенда стоя' }).first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#techList .excard', { hasText: 'Фермерская прогулка' }).first()).toBeVisible();
        /* шит «Группы мышц» → «Грудь»: своё с m:chest осталось, своё без тегов отсеялось */
        await page.locator('.card .secrow .chip', { hasText: 'Группы мышц' }).click();
        await page.locator('.modal.open .frow', { hasText: 'Грудь' }).click();
        await page.locator('.modal.open .btnrow .btn', { hasText: 'Применить' }).click();
        await expect(page.locator('#techList .excard', { hasText: 'Жим Свенда стоя' }).first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#techList .excard', { hasText: 'Фермерская прогулка' })).toHaveCount(0);
    });

    test('миграция [EXR-T14 ревью]: при непустом сервере stale-ключи localStorage всё равно очищаются', async ({ page, request }) => {
        /* сервер уже имеет свои/любимые */
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [], workouts: [], customEx: [{ n: 'Есть на сервере', tags: [] }], favs: ['Есть на сервере'] } } });
        await page.context().addInitScript(function () {
            try {
                localStorage.setItem('gymCustomEx', JSON.stringify(['Старое локальное']));
                localStorage.setItem('gymFavs', JSON.stringify(['Старый локальный фав']));
            } catch (e) { /* noop */ }
        });
        await openApp(page);
        /* stale-ключи удалены: данные из них игнорируются (сервер приоритетен) */
        await expect.poll(async function () {
            return await page.evaluate(function () {
                return String(localStorage.getItem('gymCustomEx')) + '|' + String(localStorage.getItem('gymFavs'));
            });
        }, { timeout: 8000 }).toBe('null|null');
        /* серверные данные миграцией не менялись */
        const r = await request.get('/api/state');
        const j = await r.json();
        if ((j.customEx || []).length !== 1 || (j.favs || []).length !== 1
            || j.customEx[0].n !== 'Есть на сервере') {
            throw new Error('серверные данные не должны меняться: ' + JSON.stringify(j));
        }
    });

    /* ---------- [EXR-T16/T17] acceptance coverage: acc#5 acc#7 acc#15 acc#16 ---------- */

    test('EXR-T16 acc#5: svoe bez grupp - teg-filtr Tekhniki ne nakhodit; poisk pikera nakhodit', async ({ page }) => {
        const K_ALL = 'Все';
        const K_TECH = 'Техника';
        const K_BENCH = 'Жим штанги лёжа';
        void K_ALL; void K_TECH;
        await openApp(page);
        await startWorkoutUi(page);
        await openActiveDetail(page);
        await page.locator('[data-act="openPicker"]').click();
        await page.locator('[data-act="customExerciseModal"]').click();
        await page.locator('#mCustomName').fill('Farmer Walk');
        await page.locator('[data-act="createCustom"]').click();
        await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 });
        await page.locator('[data-act="closeModal"]').first().click();
        await page.locator('[data-act="openPicker"]').click();
        await page.locator('#pickerQ').fill('farmer');
        await expect(page.locator('#pickerList .excard', { hasText: 'Farmer Walk' }).first()).toBeVisible({ timeout: 5000 });
        await page.locator('#pickerQ').fill('');
        await page.locator('.modal.open [data-act="closeModal"]').first().click();
        await page.locator('.nav .nbtn[data-act="switchTab"][data-a="tech"]').click();
        await page.locator('.card .secrow .chip[data-act="techSection"][data-a="all"]').click();
        await page.locator('.card .secrow .chip[data-act="techFiltersMuscle"]').click();
        await page.locator('.modal.open .frow[data-act="techSheetToggle"][data-a="muscle:m:chest"]').click();
        await page.locator('.modal.open #sheetApply').click();
        await expect(page.locator('#techList .excard', { hasText: K_BENCH }).first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#techList .excard', { hasText: 'Farmer Walk' })).toHaveCount(0);
    });

    test('EXR-T16 acc#7: migratsiya - save-error derzhit klyuchi localStorage; retry chistit i zalivaet na server', async ({ page, request }) => {
        await page.context().addInitScript(function () {
            try {
                localStorage.setItem('gymCustomEx', JSON.stringify(['Svend Press']));
                localStorage.setItem('gymFavs', JSON.stringify(['Подтягивания']));
            } catch (e) { /* noop */ }
        });
        let failSave = true;
        await page.route('/api/save', async function (route) {
            if (failSave) await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
            else await route.continue();
        });
        await openApp(page);
        const keys1 = await page.evaluate(function () {
            return String(localStorage.getItem('gymCustomEx')) + '|' + String(localStorage.getItem('gymFavs'));
        });
        if (keys1 === 'null|null') throw new Error('keys must survive save-error');
        const st1 = await request.get('/api/state');
        const sj1 = await st1.json();
        if ((sj1.customEx || []).length !== 0) throw new Error('data must not reach server on save-error');
        failSave = false;
        await page.reload();
        await openApp(page);
        await expect.poll(async function () {
            return await page.evaluate(function () {
                return String(localStorage.getItem('gymCustomEx')) + '|' + String(localStorage.getItem('gymFavs'));
            });
        }, { timeout: 8000 }).toBe('null|null');
        await expect.poll(async function () {
            const r = await request.get('/api/state');
            const j = await r.json();
            return (j.customEx || []).map(function (x) { return x.n; }).join(',');
        }, { timeout: 8000 }).toBe('Svend Press');
    });

    test('EXR-T17 acc#15: profil - meta katalog+i-svoi; otkryt v tekhnike otkryvaet fav so svoim', async ({ page }) => {
        const K_PULLUP = 'Подтягивания';
        const K_FAV_CARD = '⭐ Любимые упражнения';
        const K_FAV_META = 'Упражнения, отмеченные ★ — каталог и свои';
        await openApp(page);
        await startWorkoutUi(page);
        await openActiveDetail(page);
        await page.locator('[data-act="openPicker"]').click();
        await page.locator('.modal.open .secrow .chip[data-act="pickerSection"][data-a="all"]').click();
        await page.locator('#pickerList .excard', { hasText: K_PULLUP }).first().locator('.star').click();
        await page.locator('[data-act="customExerciseModal"]').click();
        await page.locator('#mCustomName').fill('Farmer Walk');
        await page.locator('#mCustomMuscles .chip[data-a="m:chest"]').click();
        await page.locator('[data-act="createCustom"]').click();
        await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 });
        await page.locator('[data-act="closeModal"]').first().click();
        await page.locator('[data-act="openPicker"]').click();
        await page.locator('.modal.open .secrow .chip[data-act="pickerSection"][data-a="coll"]').click();
        await page.locator('.modal.open #pickerCats .chip[data-act="pickerCat"][data-a="own"]').click();
        await page.locator('#pickerList .excard', { hasText: 'Farmer Walk' }).first().locator('.star').click();
        await page.locator('.modal.open [data-act="closeModal"]').first().click();
        await page.locator('.nav .nbtn[data-act="switchTab"][data-a="profile"]').click();
        const card = page.locator('.card', { hasText: K_FAV_CARD });
        await expect(card).toBeVisible({ timeout: 5000 });
        await expect(card).toContainText(K_FAV_META);
        await card.locator('[data-act="openFavs"]').click();
        await expect(page.locator('.card .secrow .chip[data-act="techSection"][data-a="fav"]')).toHaveClass(/on/, { timeout: 5000 });
        await expect(page.locator('#techList .excard', { hasText: K_PULLUP }).first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#techList .excard', { hasText: 'Farmer Walk' }).first()).toBeVisible();
    });

    test('EXR-T17 acc#16: net na-etom-ustroystve / lokalno na klyuchevykh ekranakh', async ({ page }) => {
        const K_TECH = 'Техника';
        const K_FAV_CHIP = '★ Любимые';
        const K_FAV_CARD = '⭐ Любимые упражнения';
        const K_FAV_EMPTY = '★ В Любимых пока пусто';
        const K_ON_DEVICE = 'на этом устройстве';
        const K_LOCAL = 'локально';
        const rx = new RegExp(K_ON_DEVICE + '|' + K_LOCAL, 'i');
        const noForbidden = function (txt, where) {
            if (rx.test(txt)) throw new Error('forbidden wording on ' + where);
        };
        void K_TECH; void K_FAV_CHIP;
        await openApp(page);
        await startWorkoutUi(page);
        await openActiveDetail(page);
        await page.locator('[data-act="openPicker"]').click();
        await page.locator('[data-act="customExerciseModal"]').click();
        noForbidden(await page.locator('.modal.open').innerText(), 'custom-exercise modal');
        await page.locator('[data-act="backToPicker"]').click();
        noForbidden(await page.locator('.modal.open').innerText(), 'picker');
        await page.locator('.modal.open [data-act="closeModal"]').first().click();
        await page.locator('.nav .nbtn[data-act="switchTab"][data-a="tech"]').click();
        await page.locator('.card .secrow .chip[data-act="techSection"][data-a="fav"]').click();
        await expect(page.locator('#techList .empty', { hasText: K_FAV_EMPTY })).toBeVisible({ timeout: 5000 });
        noForbidden(await page.evaluate(function () { return document.body.innerText; }), 'tech tab');
        await page.locator('.nav .nbtn[data-act="switchTab"][data-a="profile"]').click();
        await expect(page.locator('.card', { hasText: K_FAV_CARD })).toBeVisible({ timeout: 5000 });
        noForbidden(await page.evaluate(function () { return document.body.innerText; }), 'profile tab');
    });

    test('нижняя панель: 4 таба, янтарная FAB, закреплена при скролле', async ({ page }) => {
        await openApp(page);
        const nav = page.locator('.nav');
        await expect(nav.locator('.nbtn')).toHaveCount(4);
        await expect(nav.locator('.nfab')).toHaveCount(1);
        await expect(nav.locator('.nbtn', { hasText: 'История' })).toHaveClass(/on/);
        await page.evaluate(function () { document.body.style.minHeight = '2200px'; });
        await page.evaluate(function () { window.scrollTo(0, 500); });
        await page.waitForTimeout(300);
        const box = await nav.boundingBox();
        const vh = await page.evaluate(function () { return window.innerHeight; });
        if (!box) throw new Error('навигация не найдена');
        if (Math.abs(box.y + box.height - vh) > 5) throw new Error('навигация не закреплена внизу при скролле: y=' + box.y.toFixed(1) + ', vh=' + vh);
        await expect(nav.locator('.nfab')).toBeVisible();
        /* FAB начинает тренировку */
        await nav.locator('.nfab').click();
        await expect(page.locator('.modal.open')).toBeVisible({ timeout: 5000 });
    });

    test('UX-T12/T17: второй подход — ТОЛЬКО вес предыдущего в поле, повторения/подходы дефолтные, без пилюли', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        /* первый подход: подстановки нет (в упражнении ещё нет подходов), дефолт повторений — 1 */
        await expect(page.locator('.prevpill')).toHaveCount(0);
        await expect(page.locator('#mReps')).toHaveValue('1');
        await page.locator('#mWeight').fill('70');
        await page.locator('[data-act="setsSet"][data-a="1"]').click();
        await page.locator('#mReps').fill('10');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });

        /* второй подход: вес предыдущего подставлен СРАЗУ В ПОЛЕ; повторения — дефолт «1» [UX-T17] */
        await openActiveDetail(page);
        await page.locator('.expill .ex-addset[data-act="openEntryModal"]').click();
        await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#mWeight')).toHaveValue('70');
        await expect(page.locator('#mReps')).toHaveValue('1');
        await expect(page.locator('#mSets')).toHaveValue('1');
        await expect(page.locator('.prevpill')).toHaveCount(0);
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await openActiveDetail(page);
        await expect(page.locator('.expill .entry')).toHaveCount(2, { timeout: 5000 });
        await expect(page.locator('.expill .entry').nth(1)).toContainText('70 кг, 1 подход по 1 повторению', { timeout: 5000 });
    });

    test('форма записи: без чипсов-подсказок, подписи по макету', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await expect(page.locator('.modal.open')).toBeVisible({ timeout: 5000 });
        /* чипсов-подсказок нет (старые 70/90/95/100 кг, «Без веса», чипсы повторений удалены) */
        await expect(page.locator('.modal.open .chip')).toHaveCount(0);
        await expect(page.locator('.modal.open .mini-row, .modal.open .mbtn')).toHaveCount(0);
        /* подписи по гибриду */
        await expect(page.locator('.modal.open .flabel', { hasText: 'Вес, кг (0 — без веса)' })).toHaveCount(1);
        await expect(page.locator('.modal.open .flabel', { hasText: 'Повторения (например 12, 8-10)' })).toHaveCount(1);
        /* инкременты веса +0,25…+50 и ряд 10…200 */
        await expect(page.locator('.modal.open [data-act="wAdd"]')).toHaveCount(8);
        await expect(page.locator('.modal.open [data-act="wSet"]')).toHaveCount(8);
        await expect(page.locator('.modal.open .modal-box', { hasText: '+0,25' })).toBeVisible();
        /* подходы 1-8; повторения — два ряда: 1-8 и 10/12 (пресеты) + +1/+2/+5/+10, третьего ряда нет */
        await expect(page.locator('.modal.open [data-act="setsSet"]')).toHaveCount(8);
        await expect(page.locator('.modal.open [data-act="repsSet"]')).toHaveCount(10);
        await expect(page.locator('.modal.open [data-act="repsAdd"]')).toHaveCount(4);
        await page.locator('[data-act="closeModal"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible();
    });

    test('[UX-T23] модалка «Новая запись»: «← Назад» в mtitle-row закрывает без сохранения, внизу один prime', async ({ page, request }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await expect(page.locator('.modal.open')).toBeVisible({ timeout: 5000 });
        /* шапка: mtitle-row с заголовком и одной кнопкой «← Назад» (aria «Назад», closeModal) */
        const row = page.locator('.modal.open .mtitle-row');
        await expect(row.locator('.mtitle')).toHaveText('Новая запись');
        const back = row.locator('[data-act="closeModal"]');
        await expect(back).toHaveCount(1);
        await expect(back).toHaveAttribute('aria-label', 'Назад');
        await expect(row.locator('.barebtn')).toHaveCount(1);
        /* низ: единственная кнопка — жёлтая prime «➕ Добавить»; «Закрыть»/«Удалить» внизу нет */
        const bottom = page.locator('.modal.open .btnrow .btn');
        await expect(bottom).toHaveCount(1);
        await expect(bottom).toHaveClass(/prime/);
        await expect(bottom).toHaveClass(/wide/);
        await expect(bottom).toContainText('Добавить');
        await expect(page.locator('.modal.open [data-act="deleteEntry"]')).toHaveCount(0);
        /* «← Назад» закрывает модалку без сохранения */
        await back.click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        /* правок нет — на сервере упражнение появиться не должно (выход без сохранения) */
        const st = await (await request.get('/api/state')).json();
        const act = (st.workouts || []).filter(function (w) { return !w.finished; })[0];
        const sets = act && act.exercises && act.exercises[0] && act.exercises[0].sets || [];
        if (sets.length) throw new Error('закрытие «Назад» сохранило запись: ' + JSON.stringify(sets));
    });

    test('[UX-T23] модалка «Изменить запись»: 🗑 и ✕ в mtitle-row, внизу один prime «Сохранить»', async ({ page, request }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await page.locator('#mWeight').fill('100');
        await page.locator('#mSets').fill('3');
        await page.locator('#mReps').fill('8-10');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await openActiveDetail(page);
        await page.locator('.expill .entry').first().click();
        await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 });
        /* шапка: mtitle-row с 🗑 (deleteEntry, красная trash-bare) и ✕ (closeModal) */
        const row = page.locator('.modal.open .mtitle-row');
        await expect(row.locator('.mtitle')).toHaveText('Изменить запись');
        await expect(row.locator('[data-act="deleteEntry"]')).toHaveCount(1);
        await expect(row.locator('[data-act="deleteEntry"]')).toHaveClass(/trash-bare/);
        await expect(row.locator('[data-act="closeModal"]')).toHaveCount(1);
        await expect(row.locator('.barebtn')).toHaveCount(2);
        /* низ: единственная жёлтая prime «💾 Сохранить»; красной «🗑 Удалить запись» и «Закрыть» внизу нет */
        const bottom = page.locator('.modal.open .btnrow .btn');
        await expect(bottom).toHaveCount(1);
        await expect(bottom).toHaveClass(/prime/);
        await expect(bottom).toContainText('Сохранить');
        await expect(page.locator('.modal.open .btnrow .btn.danger')).toHaveCount(0);
        await expect(page.locator('.modal.open .btnrow .btn.sec')).toHaveCount(0);
        /* ✕ закрывает модалку без сохранения */
        await row.locator('[data-act="closeModal"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        /* запись не изменилась */
        await openActiveDetail(page);
        await expect(page.locator('.expill .entry').first()).toContainText('100 кг, 3 подхода по 8-10 повторений', { timeout: 5000 });
    });

    test('вес: кнопки +N прибавляют к значению, дефолт 0', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await expect(page.locator('#mWeight')).toHaveValue('0');
        await page.locator('[data-act="wAdd"][data-a="20"]').click();
        await page.locator('[data-act="wAdd"][data-a="15"]').click();
        await expect(page.locator('#mWeight')).toHaveValue('35');
        await page.locator('[data-act="setsSet"][data-a="2"]').click();
        await page.locator('#mReps').fill('12');
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
        await page.locator('#mReps').fill('12');
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
        await page.locator('#mReps').fill('10');
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

    test('вес: +0,25 и +50, запятая в записи', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await page.locator('[data-act="wAdd"][data-a="0.25"]').click();
        await page.locator('[data-act="wAdd"][data-a="50"]').click();
        await expect(page.locator('#mWeight')).toHaveValue('50.25');
        await page.locator('[data-act="setsSet"][data-a="1"]').click();
        await page.locator('#mReps').fill('12');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await openActiveDetail(page);
        await expect(page.locator('.expill .entry').first()).toContainText('50,25 кг, 1 подход по 12 повторений', { timeout: 5000 });
    });

    test('вес: быстрые значения 10-200', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await page.locator('[data-act="wSet"][data-a="100"]').click();
        await expect(page.locator('#mWeight')).toHaveValue('100');
        await page.locator('[data-act="wSet"][data-a="60"]').click();
        await expect(page.locator('#mWeight')).toHaveValue('60');
        await page.locator('[data-act="setsSet"][data-a="3"]').click();
        await page.locator('#mReps').fill('10');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await openActiveDetail(page);
        await expect(page.locator('.expill .entry').first()).toContainText('60 кг, 3 подхода по 10 повторений', { timeout: 5000 });
    });

    test('повторения: кнопки 1-8 и инкременты +N', async ({ page }) => {
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

    test('пресеты повторений 10 и 12 подставляют значение в один тап', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await page.locator('[data-act="repsSet"][data-a="10"]').click();
        await expect(page.locator('#mReps')).toHaveValue('10');
        await page.locator('[data-act="repsSet"][data-a="12"]').click();
        await expect(page.locator('#mReps')).toHaveValue('12');
        await page.locator('[data-act="setsSet"][data-a="3"]').click();
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await openActiveDetail(page);
        await expect(page.locator('.expill .entry').first()).toContainText('3 подхода по 12 повторений', { timeout: 5000 });
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
        await expect(page.locator('#mReps')).toHaveValue('1'); /* [UX-T12] дефолт повторений — 1 */
        /* после очистки значение вводится заново и сохраняется */
        await page.locator('[data-act="wAdd"][data-a="50"]').click();
        await page.locator('[data-act="setsSet"][data-a="3"]').click();
        await page.locator('#mReps').fill('10');
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
        await page.locator('#mReps').fill('10');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await openActiveDetail(page);

        /* второе и третье упражнения — чтобы в превью было ровно 3 строки упражнений */
        await page.locator('[data-act="openPicker"]').click();
        await page.locator('.modal.open .secrow .chip', { hasText: 'Все' }).first().click(); /* [UX-T30] дефолт «★ Любимые» */
        await page.locator('.modal.open .excard', { hasText: 'Подтягивания' }).first().click();
        await page.locator('#mReps').fill('10');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await page.locator('[data-act="openPicker"]').click();
        await page.locator('.modal.open .secrow .chip', { hasText: 'Все' }).first().click(); /* [UX-T30] дефолт «★ Любимые» */
        await page.locator('.modal.open .excard', { hasText: 'Жим ногами' }).first().click();
        await page.locator('#mReps').fill('12');
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


    test('темы: подсказка клиента при первом входе, выбор сохраняется после перезагрузки', async ({ page }) => {
        await openApp(page);
        /* telegram-web-app.js вне Telegram отдаёт светлую тему клиента — подсказка = light */
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light', { timeout: 5000 });
        await page.locator('[aria-label="Настройки"]').click();
        /* [UX-T27] тогл «Тёмная тема»: светлая фактическая → OFF; клик мгновенно темнит [UX-S4 §12.3] */
        const sw = page.locator('[role="switch"][aria-label="Тёмная тема"]');
        await expect(sw).toHaveAttribute('aria-checked', 'false', { timeout: 5000 });
        await sw.click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark', { timeout: 5000 });
        await expect(sw).toHaveAttribute('aria-checked', 'true');
        await expect(sw).toHaveClass(/on/);
        const saved = await page.evaluate(function () { try { return localStorage.getItem('gymTheme'); } catch (e) { return null; } });
        if (saved !== 'dark') throw new Error('gymTheme не сохранён: ' + saved);
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark', { timeout: 5000 });
        /* возврат на светлую тоже сохраняется */
        await page.locator('[aria-label="Настройки"]').click();
        await page.locator('[role="switch"][aria-label="Тёмная тема"]').click();
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light', { timeout: 5000 });
    });

    test('легаси-темы маппятся на пару Amber Glass: forest→dark, sage→light', async ({ page }) => {
        /* кладём значение до загрузки приложения: на живой странице localStorage,
           затем reload — приложение читает gymTheme при старте */
        await page.goto('/');
        await page.evaluate(function () { try { localStorage.setItem('gymTheme', 'forest'); } catch (e) { /* noop */ } });
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark', { timeout: 10000 });

        await page.evaluate(function () { try { localStorage.setItem('gymTheme', 'sage'); } catch (e) { /* noop */ } });
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light', { timeout: 10000 });
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
        /* есть история → FAB открывает модалку «Новая тренировка» [UX-T7]; стартуем с пустого списка */
        await page.locator('.nav .nfab').click();
        await page.locator('.modal.open [data-act="newBlank"]').click();
        await expect(page.locator('.modal.open')).toBeVisible({ timeout: 5000 });
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
        /* после старта мы на экране карточки — жмём FAB ещё раз: активная тренировка открывается, дубликат не создаётся */
        await page.locator('.nav .nfab').click();
        await expect(page.locator('.modal.open')).toBeVisible({ timeout: 5000 });
        await page.locator('.modal.open [data-act="closeModal"]').first().click();
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
        /* [UX-T30] дефолт пикера — «★ Любимые»; поиск по каталогу — на «Все» */
        await touchTap(page, page.locator('.modal.open .secrow .chip', { hasText: 'Все' }).first());

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
        await touchTap(page, page.locator('.nav .nfab'));
        const modal = page.locator('.modal.open');
        await modal.waitFor({ state: 'visible', timeout: 5000 });
        /* [UX-T30] дефолт пикера — «★ Любимые»; выбор из каталога — через «Все» */
        await touchTap(page, modal.locator('.secrow .chip', { hasText: 'Все' }).first());
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
        await expect(page.locator('#app .hero, #app .pcard').first()).toBeVisible({ timeout: 10000 });
        await openActiveDetail(page);
        await expect(page.locator('.expill .entry').first()).toContainText('100 кг, 3 подхода по 8-10 повторений', { timeout: 5000 });
    });
});

/* ===== спринт 1: таймер отдыха [UX-T4], live-PR + 1ПМ [UX-T2], шаблоны [UX-T6/T7] ===== */

/* формат остатка таймера — как restFmt в app.js: «M:SS» */
function restFmt(s) {
    s = Math.max(0, Math.round(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function pad2(n) { return String(n).padStart(2, '0'); }
/* лог блока в открытой модалке ввода: вес/подходы/повторения → «Добавить» */
async function fillEntry(page, w, s, r) {
    await page.locator('#mWeight').fill(String(w));
    if (s != null) await page.locator('#mSets').fill(String(s));
    await page.locator('#mReps').fill(String(r));
    await page.locator('[data-act="saveEntry"]').click();
    await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
}

test.describe('таймер отдыха [UX-T4]', function () {

    test('автозапуск после записи подхода: отсчёт, подпись упражнения; новый подход перезапускает; пилюля разворачивается', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await fillEntry(page, '60', '1', '10');
        const bar = page.locator('#restbar');
        await expect(bar).toBeVisible({ timeout: 5000 });
        await expect(bar).not.toHaveClass(/hidden/);
        /* дефолт 90 сек: остаток 1:30 и дальше по убывающей */
        await expect(bar.locator('#rbTime')).toHaveText(/^(1:28|1:29|1:30)$/, { timeout: 5000 });
        /* [UX-T17] «Отдых · Упражнение» — в title компактной панели */
        await expect(bar.locator('.rb-main')).toHaveAttribute('title', 'Отдых · ' + EX);
        /* лог нового подхода перезапускает таймер на полную длительность (§1.8) */
        const end1 = await page.evaluate(function () { return JSON.parse(localStorage.getItem('gymRest')).end; });
        await page.waitForTimeout(2100);
        await page.locator('.expill .ex-addset[data-act="openEntryModal"]').click();
        await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 });
        await fillEntry(page, '60', '1', '10');
        const end2 = await page.evaluate(function () { return JSON.parse(localStorage.getItem('gymRest')).end; });
        if (end2 - end1 < 1500) throw new Error('новый подход не перезапустил таймер: сдвиг end ' + (end2 - end1) + ' мс');
        await expect(bar.locator('#rbTime')).toHaveText(/^(1:28|1:29|1:30)$/, { timeout: 5000 });
        /* сворачивается в пилюлю и разворачивается обратно */
        await bar.locator('[data-act="restFold"]').click();
        await expect(bar.locator('.rb-pill')).toBeVisible({ timeout: 5000 });
        await expect(bar.locator('.rb-pill')).toContainText('⏱');
        await bar.locator('[data-act="restUnfold"]').click();
        await expect(bar.locator('#rbTime')).toBeVisible({ timeout: 5000 });
    });

    test('перезагрузка страницы: таймер восстанавливается с правильным остатком (абсолютная метка end, Date не мокаем)', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await fillEntry(page, '80', '1', '10');
        await expect(page.locator('#restbar #rbTime')).toBeVisible({ timeout: 5000 });
        /* сворачиваем в пилюлю — свёрнутость тоже должна пережить перезагрузку (§1.7) */
        await page.locator('#restbar [data-act="restFold"]').click();
        await expect(page.locator('#restbar .rb-pill')).toBeVisible({ timeout: 5000 });
        await page.waitForTimeout(2000);
        await page.reload();
        await expect(page.locator('#app .hero, #app .pcard').first()).toBeVisible({ timeout: 10000 });
        const bar = page.locator('#restbar');
        await expect(bar.locator('.rb-pill')).toBeVisible({ timeout: 5000 });
        /* остаток считаем от абсолютной метки end локальным временем;
           допустимый разброс ±1 сек — цифру рисует секундный тик */
        const left = await page.evaluate(function () {
            const r = JSON.parse(localStorage.getItem('gymRest'));
            return Math.ceil((r.end - Date.now()) / 1000);
        });
        if (!(left > 60 && left <= 89)) throw new Error('остаток после перезагрузки: ' + left + ' сек (жи 90, прошло ~2 с)');
        const pillTxt = (await bar.locator('.rb-pill').textContent()) || '';
        if (!pillTxt.includes(restFmt(left)) && !pillTxt.includes(restFmt(left + 1)) && !pillTxt.includes(restFmt(left - 1))) {
            throw new Error('пилюля показывает ' + JSON.stringify(pillTxt) + ', ожидали ~' + restFmt(left));
        }
        /* разворачиваем: компактная панель восстановилась, подпись упражнения в title [UX-T17] */
        await bar.locator('[data-act="restUnfold"]').click();
        await expect(bar.locator('#rbTime')).toBeVisible({ timeout: 5000 });
        await expect(bar.locator('.rb-main')).toHaveAttribute('title', 'Отдых · ' + EX);
    });

    test('пауза замораживает остаток, продолжение тикает, «+30 сек» удлиняет отсчёт и шкалу', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await fillEntry(page, '60', '1', '10');
        const bar = page.locator('#restbar');
        await expect(bar.locator('#rbTime')).toBeVisible({ timeout: 5000 });
        /* пауза: left сохранён, end удалён, цифры замерли ([UX-T17] кнопка-иконка: ⏸/▶ toggle) */
        await bar.locator('[data-act="restPause"]').click();
        await expect(bar.locator('[data-act="restPause"]')).toHaveText('▶');
        await expect(bar.locator('[data-act="restPause"]')).toHaveAttribute('title', 'Продолжить');
        await expect(bar.locator('#rbTime')).toHaveClass(/paused/);
        const p = await page.evaluate(function () {
            const r = JSON.parse(localStorage.getItem('gymRest'));
            return { paused: r.paused, left: r.left || 0, hasEnd: 'end' in r };
        });
        if (!p.paused || !(p.left > 0) || p.hasEnd) throw new Error('пауза не записала left / не удалила end: ' + JSON.stringify(p));
        const t1 = await bar.locator('#rbTime').textContent();
        await page.waitForTimeout(2200);
        const t2 = await bar.locator('#rbTime').textContent();
        if (t1 !== t2) throw new Error('остаток тикает на паузе: ' + t1 + ' → ' + t2);
        /* продолжение: отсчёт пошёл дальше (poll: фаза секундного тика не привязана к клику) */
        await bar.locator('[data-act="restPause"]').click();
        await expect(bar.locator('[data-act="restPause"]')).toHaveText('⏸');
        const t3 = await bar.locator('#rbTime').textContent();
        await expect.poll(async function () { return bar.locator('#rbTime').textContent(); }, { timeout: 5000 }).not.toBe(t3);
        /* +30 сек: end += 30 c, полная длительность 90 → 120 */
        const endBefore = await page.evaluate(function () { return JSON.parse(localStorage.getItem('gymRest')).end; });
        await bar.locator('[data-act="restMore"]').click();
        const st = await page.evaluate(function () {
            const r = JSON.parse(localStorage.getItem('gymRest'));
            return { end: r.end, dur: r.dur };
        });
        if (st.end - endBefore !== 30000) throw new Error('+30 сек: end сдвинулся на ' + (st.end - endBefore) + ' мс');
        if (st.dur !== 120) throw new Error('+30 сек: dur = ' + st.dur + ', ожидалось 120');
        const leftNow = await page.evaluate(function () {
            return Math.ceil((JSON.parse(localStorage.getItem('gymRest')).end - Date.now()) / 1000);
        });
        const txt = await bar.locator('#rbTime').textContent();
        if (txt !== restFmt(leftNow) && txt !== restFmt(leftNow + 1) && txt !== restFmt(leftNow - 1)) {
            throw new Error('после «+30» на панели ' + txt + ', ожидали ~' + restFmt(leftNow));
        }
    });

    test('истечение: glow-состояние «Перерыв окончен», тост, «Скрыть» убирает панель и ключ', async ({ page }) => {
        /* короткий остаток кладём напрямую в localStorage (тест-сетап), Date не мокаем:
           end — абсолютная метка, приложение считает от неё (§1.7) */
        await page.addInitScript(function () {
            try {
                localStorage.setItem('gymRest', JSON.stringify({ end: Date.now() + 2500, dur: 90, paused: false, mini: false, ex: 'Жим штанги лёжа' }));
            } catch (e) { /* noop */ }
        });
        await openApp(page);
        const bar = page.locator('#restbar');
        await expect(bar).toBeVisible({ timeout: 5000 });
        await expect(bar.locator('#rbTime')).toBeVisible({ timeout: 5000 });
        /* сигнал по окончании: тост «⏱ Отдых окончен» */
        await expect(page.locator('.toast.show')).toHaveText('⏱ Отдых окончен', { timeout: 8000 });
        /* состояние «Истёк»: glow-карточка с кнопкой «Скрыть» */
        await expect(bar.locator('.rb-done .txt')).toHaveText('Перерыв окончен — время работать 💪');
        await expect(bar.locator('[data-act="restHide"]')).toHaveText('Скрыть');
        await bar.locator('[data-act="restHide"]').click();
        await expect(bar).toHaveClass(/hidden/);
        const key = await page.evaluate(function () { return localStorage.getItem('gymRest'); });
        if (key !== null) throw new Error('ключ gymRest не удалён после «Скрыть»: ' + key);
    });

    test('профиль: чип 180 меняет дефолт (сервер хранит restSec), «Своё…» 700 отклоняется / 240 сохраняется, таймер стартует на выбранное', async ({ page, request }) => {
        await openApp(page);
        /* [UX-T27] таймер отдыха переехал из Профиля в Настройки */
        await page.locator('[aria-label="Настройки"]').click();
        const card = page.locator('.card', { hasText: '⏱ Таймер отдыха' });
        /* дефолт 90 активен из коробки */
        await expect(card.locator('.chip', { hasText: '90' })).toHaveClass(/on/, { timeout: 5000 });
        /* чип 180: сохранение в G.restSec → на сервер (merge-политика /api/save) */
        await card.locator('.chip', { hasText: '180' }).click();
        await expect(page.locator('.toast.show')).toHaveText('✓ Сохранено', { timeout: 5000 });
        await expect(card.locator('.chip', { hasText: '180' })).toHaveClass(/on/);
        let st = await (await request.get('/api/state')).json();
        if (st.restSec !== 180) throw new Error('сервер не хранит restSec=180: ' + JSON.stringify(st.restSec));
        /* «Своё…»: вне диапазона отклоняется, 30–600 сохраняется */
        await card.locator('.chip', { hasText: 'Своё…' }).click();
        await page.locator('#restCustomSec').fill('700');
        await page.locator('[data-act="restCustomSave"]').click();
        await expect(page.locator('.toast.err')).toBeVisible({ timeout: 5000 });
        await page.locator('#restCustomSec').fill('240');
        /* dedup-гвардия действий 400 мс: кнопка «ОК» та же нода (render при ошибке не было) — ждём окно */
        await page.waitForTimeout(450);
        await page.locator('[data-act="restCustomSave"]').click();
        /* тост = подтверждение, что save() дошёл до сервера (класс on у чипа появляется и до сохранения) */
        await expect(page.locator('.toast.show')).toHaveText('✓ Сохранено', { timeout: 5000 });
        await expect(card.locator('.chip', { hasText: 'Своё…' })).toHaveClass(/on/);
        st = await (await request.get('/api/state')).json();
        if (st.restSec !== 240) throw new Error('сервер не хранит restSec=240: ' + JSON.stringify(st.restSec));
        /* следующий подход отдыхает 240 сек */
        await page.locator('.nav button', { hasText: 'История' }).click();
        await startAndPick(page, EX);
        await fillEntry(page, '50', '1', '10');
        await expect(page.locator('#rbTime')).toHaveText(/^(3:58|3:59|4:00)$/, { timeout: 5000 });
    });

    test('«Выкл»: чип сохраняет restSec=0 на сервере, после записи подхода отсчёт не запускается', async ({ page, request }) => {
        await openApp(page);
        /* [UX-T27] таймер отдыха переехал из Профиля в Настройки */
        await page.locator('[aria-label="Настройки"]').click();
        const card = page.locator('.card', { hasText: '⏱ Таймер отдыха' });
        await expect(card.locator('.chip', { hasText: '90' })).toHaveClass(/on/, { timeout: 5000 });
        await card.locator('.chip', { hasText: 'Выкл' }).click();
        await expect(page.locator('.toast.show')).toHaveText('✓ Сохранено', { timeout: 5000 });
        await expect(card.locator('.chip', { hasText: 'Выкл' })).toHaveClass(/on/);
        await expect(card.locator('.chip', { hasText: '90' })).not.toHaveClass(/on/);
        /* restSec=0 доехал до сервера (спец-значение «выкл», а не «настройки нет») */
        const st = await (await request.get('/api/state')).json();
        if (st.restSec !== 0) throw new Error('сервер не хранит restSec=0: ' + JSON.stringify(st.restSec));
        /* запись подхода не запускает отсчёт: панель скрыта, ключа gymRest нет */
        await page.locator('.nav button', { hasText: 'История' }).click();
        await startAndPick(page, EX);
        await fillEntry(page, '60', '1', '10');
        await expect(page.locator('#restbar')).toHaveClass(/hidden/, { timeout: 5000 });
        const key = await page.evaluate(function () { return localStorage.getItem('gymRest'); });
        if (key !== null) throw new Error('таймер запустился при «выкл»: ' + key);
    });

    /* [UX-B12] «Своё…» был мёртв после «Выкл»: custom = !off && … глушил REST_CUSTOM —
       тап молча не открывал инлайн-поле (выглядело как некликабельность). Клики обычные,
       без force: Playwright проверяет реальный hit до клика */
    test('«Своё…»: поле открывается и после «Выкл» (UX-B12), 45 сохраняется на сервере', async ({ page, request }) => {
        await openApp(page);
        await page.locator('[aria-label="Настройки"]').click();
        const card = page.locator('.card', { hasText: '⏱ Таймер отдыха' });
        await expect(card.locator('.chip', { hasText: '90' })).toHaveClass(/on/, { timeout: 5000 });
        /* обычный путь: тап «Своё…» → инлайн-поле появилось */
        await card.locator('.chip', { hasText: 'Своё…' }).click();
        await expect(page.locator('#restCustomSec')).toBeVisible({ timeout: 5000 });
        await page.locator('#restCustomSec').fill('45');
        await page.locator('[data-act="restCustomSave"]').click();
        await expect(page.locator('.toast.show')).toHaveText('✓ Сохранено', { timeout: 5000 });
        await expect(card.locator('.chip', { hasText: 'Своё…' })).toHaveClass(/on/);
        let st = await (await request.get('/api/state')).json();
        if (st.restSec !== 45) throw new Error('сервер не хранит restSec=45: ' + JSON.stringify(st.restSec));
        /* баг-путь UX-B12: «Выкл» → «Своё…» — поле обязано открыться (раньше тап молчал);
           подсветка честная: при off горит «Выкл», пока своё значение не сохранено */
        await card.locator('.chip', { hasText: 'Выкл' }).click();
        await expect(page.locator('.toast.show')).toHaveText('✓ Сохранено', { timeout: 5000 });
        await expect(card.locator('.chip', { hasText: 'Выкл' })).toHaveClass(/on/);
        await card.locator('.chip', { hasText: 'Своё…' }).click();
        await expect(page.locator('#restCustomSec')).toBeVisible({ timeout: 5000 });
        await expect(card.locator('.chip', { hasText: 'Своё…' })).not.toHaveClass(/on/);
        await page.locator('#restCustomSec').fill('45');
        await page.locator('[data-act="restCustomSave"]').click();
        await expect(page.locator('.toast.show')).toHaveText('✓ Сохранено', { timeout: 5000 });
        await expect(card.locator('.chip', { hasText: 'Своё…' })).toHaveClass(/on/);
        st = await (await request.get('/api/state')).json();
        if (st.restSec !== 45) throw new Error('после «Выкл» сервер не хранит restSec=45: ' + JSON.stringify(st.restSec));
    });
});

test.describe('live-PR и оценка 1ПМ [UX-T2]', function () {

    test('тост «Новый рекорд» появляется и исчезает, чип 🏆 у записи, «Оценка 1ПМ · Эпли» в статистике', async ({ page, request }) => {
        const now = new Date();
        const yesterday = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
        /* база: жим 100 кг × 3 × 8-10 → e1RM = 100 × (1 + 9/30) = 130 */
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            profile: { sex: 'м', age: 30, height: 180, weight: 90 },
            workouts: [doneWorkout(1, yesterday, EX, '100', 3)]
        } } });
        await openApp(page);
        await page.locator('.nav .nfab').click();
        await page.locator('.modal.open [data-act="newBlank"]').click();
        await page.locator('.modal.open .secrow .chip', { hasText: 'Все' }).first().click(); /* [UX-T30] дефолт «★ Любимые» */
        await page.locator('.modal.open .excard', { hasText: EX }).first().click();
        await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 });
        /* новый блок 110 кг × 1 × 8 → e1RM = 110 × (1 + 8/30) ≈ 139 > 130 → PR */
        const e1rm = Math.round(110 * (1 + 8 / 30));
        await fillEntry(page, '110', '1', '8');
        const toast = page.locator('.toast.show');
        await expect(toast).toHaveText('🏆 Новый рекорд! 1ПМ ≈ ' + e1rm + ' кг', { timeout: 5000 });
        await expect(toast).toHaveClass(/pr/);
        /* тост исчезает (PR-тост живёт 3.5 с) */
        await expect(page.locator('.toast.show')).not.toBeVisible({ timeout: 6000 });
        /* чип 🏆 с оценкой 1ПМ у подхода-рекордсмена */
        await expect(page.locator('.expill .entry .prtag').first()).toHaveText('🏆 ' + e1rm, { timeout: 5000 });
        /* завершаем: статистика считает только завершённые */
        await page.locator('[data-act="finishWorkout"]').click();
        await expect(page.locator('.toast.show')).toHaveText('✅ Тренировка завершена', { timeout: 5000 });
        await page.locator('.nav button', { hasText: 'Статистика' }).click();
        const card = page.locator('.card', { hasText: 'Оценка 1ПМ · Эпли' });
        await expect(card).toBeVisible({ timeout: 5000 });
        const row = card.locator('.prmrow', { hasText: EX });
        await expect(row.locator('.prmval')).toContainText('≈ ' + e1rm);
        await expect(row).toContainText('лучший подход: 110 кг × 8');
    });
});

test.describe('шаблоны тренировок [UX-T6/T7]', function () {

    test('новичок: без истории и шаблонов FAB стартует мгновенно, без модалки выбора', async ({ page, request }) => {
        await openApp(page);
        await page.locator('.nav .nfab').click();
        await expect(page.locator('.modal.open')).toBeVisible({ timeout: 5000 });
        /* открылся пикер («Добавить упражнение»), а не модалка «Новая тренировка» */
        await expect(page.locator('#pickerQ')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.modal.open')).not.toContainText('Новая тренировка');
        const st = await (await request.get('/api/state')).json();
        const unfin = (st.workouts || []).filter(function (w) { return !w.finished; });
        if (unfin.length !== 1) throw new Error('мгновенный старт не создал ровно одну тренировку: ' + unfin.length);
    });

    /* [UX-T18] иконка «💾 В шаблоны» из шапки завершённой удалена (сохранение шаблона —
       только в боте), поэтому сам тап по ней не воспроизводится: шаблон сеется через API,
       а тест покрывает оставшуюся цепочку — модалка старта, старт из шаблона, план на сервере */
    test('старт из шаблона: модалка выбора, тост, пустой список упражнений с планом на сервере', async ({ page, request }) => {
        const today = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            workouts: [doneWorkout(1, today, EX, '100', 3)],
            templates: [{ id: 1, name: EX, createdAt: today + 'T10:35:00',
                exercises: [{ name: EX, w: '100', s: 3, r: '10' }] }]
        } } });
        await openApp(page);
        await page.locator('.nav .nfab').click();
        const m2 = page.locator('.modal.open');
        await expect(m2).toContainText('Новая тренировка', { timeout: 5000 });
        await expect(m2).toContainText('📋 Шаблоны · 1 из 20');
        const tcard = m2.locator('.tcard');
        await expect(tcard).toHaveCount(1);
        await expect(tcard).toContainText(EX);
        await expect(tcard).toContainText('1 упр.');
        /* старт из шаблона: тост + незавершённая тренировка с пустыми записями */
        await tcard.click();
        await expect(page.locator('.toast.show')).toHaveText('📋 Шаблон применён: 1 упражнение', { timeout: 5000 });
        await expect(page.locator('.backbar', { hasText: 'Завершить' })).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.expill .exname')).toHaveText(EX);
        await expect(page.locator('.expill .entry')).toHaveCount(0);
        const st2 = await (await request.get('/api/state')).json();
        const fresh = (st2.workouts || []).filter(function (w) { return !w.finished; })[0];
        if (!fresh || !fresh.exercises.length || fresh.exercises[0].name !== EX || fresh.exercises[0].sets.length) {
            throw new Error('старт из шаблона создал не то: ' + JSON.stringify(fresh));
        }
        const te = fresh.exercises[0];
        if (te.pw !== '100' || te.ps !== 3 || te.pr !== '10') {
            throw new Error('план шаблона не доехал в запись: ' + JSON.stringify(te));
        }
    });

    test('«Повторить прошлую» копирует упражнения; удаление шаблона отражается в модалке старта и на сервере', async ({ page, request }) => {
        const now = new Date();
        const d7 = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7));
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 3, del: [],
            profile: { sex: 'м', age: 30, height: 180, weight: 90 },
            workouts: [doneWorkout(1, d7, 'Подтягивания', '0', 4), doneWorkout(2, isoDate(now), EX, '80', 3)],
            templates: [{ id: 1, name: 'Спина и бицепс', createdAt: '2026-11-06T18:30:00',
                exercises: [{ name: 'Тяга верхнего блока', w: '60', s: 3, r: '10' }, { name: 'Подтягивания', w: '', s: 4, r: '8' }] }]
        } } });
        await openApp(page);
        await page.locator('.nav .nfab').click();
        const m = page.locator('.modal.open');
        await expect(m).toContainText('Новая тренировка', { timeout: 5000 });
        await expect(m).toContainText('📋 Шаблоны · 1 из 20');
        /* подпись повтора: дата последней завершённой (спека §4.7) + число упражнений */
        const rep = m.locator('[data-act="newRepeat"]');
        await expect(rep).toContainText('🔁 Повторить прошлую');
        await expect(rep).toContainText(pad2(now.getDate()) + '.' + pad2(now.getMonth() + 1));
        await expect(rep).toContainText('1 упражнение');
        await rep.click();
        await expect(page.locator('.toast.show')).toHaveText('🔁 Повтор прошлой тренировки: 1 упражнение', { timeout: 5000 });
        await expect(page.locator('.expill .exname')).toHaveText(EX);
        await expect(page.locator('.expill .entry')).toHaveCount(0);
        /* удаляем созданную тренировку, чтобы снова попасть в модалку старта ([UX-T22]: корзина — в backbar) */
        await page.locator('.backbar [data-act="confirmModal"]').click();
        await page.locator('.modal.open [data-act="confirmYes"]').click();
        await page.locator('.nav .nfab').click();
        await expect(m).toContainText('Новая тренировка', { timeout: 5000 });
        /* удаление шаблона: 🗑 → confirm → модалка отражает состав */
        await m.locator('.tcard .tdel').click();
        await expect(page.locator('.modal.open')).toContainText('Удалить шаблон «Спина и бицепс»?', { timeout: 5000 });
        await page.locator('.modal.open [data-act="confirmYes"]').click();
        await expect(page.locator('.toast.show')).toHaveText('Шаблон удалён', { timeout: 5000 });
        await expect(m).toContainText('Новая тренировка');
        await expect(m.locator('.tcard')).toHaveCount(0);
        await expect(m).not.toContainText('📋 Шаблоны');
        const st = await (await request.get('/api/state')).json();
        if ((st.templates || []).length !== 0) throw new Error('шаблон не удалён на сервере: ' + JSON.stringify(st.templates));
    });

    test('legacy JSON без restSec/templates: дефолт отдыха 90, секции шаблонов нет, флоу работает', async ({ page, request }) => {
        const now = new Date();
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            profile: { sex: 'м', age: 30, height: 180, weight: 90 },
            workouts: [doneWorkout(1, isoDate(now), EX, '70', 3)]
            /* намеренно нет ни restSec, ни templates — как в старом data/*.json */
        } } });
        await openApp(page);
        /* [UX-T27] таймер отдыха переехал из Профиля в Настройки (дефолтный чип 90 — в G.restSec) */
        await page.locator('[aria-label="Настройки"]').click();
        const card = page.locator('.card', { hasText: '⏱ Таймер отдыха' });
        await expect(card.locator('.chip', { hasText: '90' })).toHaveClass(/on/, { timeout: 5000 });
        await expect(card.locator('.chip', { hasText: '180' })).not.toHaveClass(/on/);
        /* старт: модалка выбора есть (история), но секции «📋 Шаблоны» нет */
        await page.locator('.nav button', { hasText: 'История' }).click();
        await page.locator('.nav .nfab').click();
        const m = page.locator('.modal.open');
        await expect(m).toContainText('Новая тренировка', { timeout: 5000 });
        await expect(m).not.toContainText('📋 Шаблоны');
        await expect(m).toContainText('🔁 Повторить прошлую');
        /* таймер отдыха стартует с дефолта 90 сек */
        await m.locator('[data-act="newBlank"]').click();
        await page.locator('.modal.open .secrow .chip', { hasText: 'Все' }).first().click(); /* [UX-T30] дефолт «★ Любимые» */
        await page.locator('.modal.open .excard', { hasText: EX }).first().click();
        await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 });
        await fillEntry(page, '70', '1', '10');
        await expect(page.locator('#rbTime')).toHaveText(/^(1:28|1:29|1:30)$/, { timeout: 5000 });
    });
});

/* ===== [UX-E5] шаблоны с весами и подходами: пилюля плана, тост повтора, строка плана карточки ===== */
test.describe('шаблоны с планом [UX-E5]', function () {

    test('старт из шаблона: строка плана в карточке → пилюля плана → тап заполняет w/s/r → лог → пилюля ушла', async ({ page, request }) => {
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            workouts: [],
            templates: [{ id: 1, name: 'Спина и бицепс', createdAt: '2026-11-07T18:30:00',
                exercises: [{ name: EX, w: '60', s: 3, r: '10' }, { name: 'Подтягивания', w: '', s: 4, r: '8' }] }]
        } } });
        await openApp(page);
        await page.locator('.nav .nfab').click();
        const m = page.locator('.modal.open');
        await expect(m).toContainText('Новая тренировка', { timeout: 5000 });
        /* карточка шаблона показывает компактный план (§4.3) */
        const tcard = m.locator('.tcard');
        await expect(tcard).toContainText('2 упр.');
        await expect(tcard.locator('.tplan')).toContainText(EX + ' 60×3×10', { timeout: 5000 });
        await expect(tcard.locator('.tplan')).toContainText('Подтягивания 4×8');
        await tcard.click();
        await expect(page.locator('.toast.show')).toHaveText('📋 Шаблон применён: 2 упражнения', { timeout: 5000 });
        /* пилюля плана в модалке записи (у записи ещё нет подходов) */
        await page.locator('.expill .ex-addset[data-act="openEntryModal"]').first().click();
        const pill = page.locator('.prevpill');
        await expect(pill).toContainText('📋 План: 60 кг × 3 × 10 — подставить', { timeout: 5000 });
        /* тап заполняет вес/подходы/повторы */
        await pill.click();
        await expect(page.locator('#mWeight')).toHaveValue('60');
        await expect(page.locator('#mSets')).toHaveValue('3');
        await expect(page.locator('#mReps')).toHaveValue('10');
        /* пилюля остаётся — работает как «вернуть план» (§4.2) */
        await expect(pill).toBeVisible();
        await page.locator('#mWeight').fill('65');
        await pill.click();
        await expect(page.locator('#mWeight')).toHaveValue('60');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await expect(page.locator('.expill .entry').first()).toContainText('60 кг, 3 подхода по 10 повторений', { timeout: 5000 });
        /* после первого блока пилюля плана ушла — [UX-T12/T17] вес предыдущего в поле, повторения — дефолт «1» */
        await page.locator('.expill .ex-addset[data-act="openEntryModal"]').first().click();
        await expect(page.locator('#mWeight')).toHaveValue('60', { timeout: 5000 });
        await expect(page.locator('#mReps')).toHaveValue('1');
        await expect(page.locator('.prevpill')).toHaveCount(0);
        await page.locator('[data-act="closeModal"]').click();
        /* план доехал до сервера внутри записи (pw/ps/pr) */
        const st = await (await request.get('/api/state')).json();
        const fresh = (st.workouts || []).filter(function (w) { return !w.finished; })[0];
        const e0 = fresh && fresh.exercises && fresh.exercises[0];
        if (!e0 || e0.pw !== '60' || e0.ps !== 3 || e0.pr !== '10') {
            throw new Error('план не доехал до сервера: ' + JSON.stringify(e0));
        }
    });

    test('«Повторить прошлую»: пилюля с фактическим весом последнего блока; без веса — «свой вес»', async ({ page, request }) => {
        const now = new Date();
        const today = isoDate(now);
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            workouts: [{ id: 1, date: today, started: today + 'T09:30:00', ended: today + 'T10:30:00',
                finished: true, title: '', nutrition: '',
                exercises: [
                    { name: EX, st: today + 'T09:31:00', en: today + 'T10:00:00',
                        sets: [{ w: '70', s: 1, r: '10', t: today + 'T09:32:00' },
                               { w: '80', s: 3, r: '8-10', t: today + 'T09:40:00' }] },
                    { name: 'Подтягивания', st: today + 'T09:31:00', en: today + 'T10:00:00',
                        sets: [{ w: '', s: 4, r: '8', t: today + 'T09:35:00' }] }
                ] }]
        } } });
        await openApp(page);
        await page.locator('.nav .nfab').click();
        const m = page.locator('.modal.open');
        await expect(m).toContainText('Новая тренировка', { timeout: 5000 });
        await m.locator('[data-act="newRepeat"]').click();
        await expect(page.locator('.toast.show')).toHaveText('🔁 Повтор прошлой тренировки: 2 упражнения', { timeout: 5000 });
        /* первое упражнение: пилюля показывает ФАКТИЧЕСКИЙ последний блок (80, а не 70) */
        await page.locator('.expill .ex-addset[data-act="openEntryModal"]').first().click();
        const pill = page.locator('.prevpill');
        await expect(pill).toContainText('📋 План: 80 кг × 3 × 8-10 — подставить', { timeout: 5000 });
        await pill.click();
        await expect(page.locator('#mWeight')).toHaveValue('80');
        await expect(page.locator('#mSets')).toHaveValue('3');
        await expect(page.locator('#mReps')).toHaveValue('8-10');
        await page.locator('[data-act="closeModal"]').click();
        /* второе упражнение без веса: пилюля «свой вес × 4 × 8» */
        await page.locator('.expill .ex-addset[data-act="openEntryModal"]').nth(1).click();
        const pill2 = page.locator('.prevpill');
        await expect(pill2).toContainText('📋 План: свой вес × 4 × 8 — подставить', { timeout: 5000 });
        await pill2.click();
        await expect(page.locator('#mWeight')).toHaveValue('0'); /* вес не тронут — остался «0» */
        await expect(page.locator('#mSets')).toHaveValue('4');
        await expect(page.locator('#mReps')).toHaveValue('8');
        await page.locator('[data-act="closeModal"]').click();
        const st = await (await request.get('/api/state')).json();
        const fresh = (st.workouts || []).filter(function (w) { return !w.finished; })[0];
        if (!fresh || fresh.exercises.length !== 2) throw new Error('повтор создал не то: ' + JSON.stringify(fresh));
        const e0 = fresh.exercises[0], e1 = fresh.exercises[1];
        if (e0.pw !== '80' || e0.ps !== 3 || e0.pr !== '8-10') throw new Error('план жима: ' + JSON.stringify(e0));
        if (e1.pw !== '' || e1.ps !== 4 || e1.pr !== '8') throw new Error('план подтягиваний: ' + JSON.stringify(e1));
    });
});

/* ===== [UX-T18] восемь правок по фидбеку владельца ===== */
test.describe('UX-T18: иконки времени, backbar-удаление, звезда в технике, центровка таймера', function () {

    test('[UX-T20] иконки времени в карточках не рендерятся; dayPart (границы 5/11/17/23) жив через __gymExpose', async ({ page, request }) => {
        const today = isoDate(new Date());
        const mk = function (id, time) {
            return { id: id, date: today, started: today + 'T' + time, ended: today + 'T' + time, finished: true, title: '', nutrition: '',
                exercises: [{ name: EX, st: today + 'T' + time, en: today + 'T' + time,
                    sets: [{ w: '60', s: 2, r: '10', t: today + 'T' + time }] }] };
        };
        /* ночь 02:30 → moon, утро 06:30 → sunrise, день 12:30 → sun, вечер 18:30 → evening */
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 5, del: [],
            workouts: [mk(1, '02:30:00'), mk(2, '06:30:00'), mk(3, '12:30:00'), mk(4, '18:30:00')]
        } } });
        await openApp(page);
        await expect(page.locator('.pcard')).toHaveCount(4, { timeout: 5000 });
        /* рендера иконки времени больше нет: ни одного .dp-inline в превью и карточках */
        await expect(page.locator('.dp-inline')).toHaveCount(0);
        /* код сохранён «до лучших времён»: ключи ICONS sunrise/sun/evening/moon на месте */
        const icons = await page.evaluate(function () {
            return ['sunrise', 'sun', 'evening', 'moon'].map(function (k) { return !!ICONS[k]; }).every(Boolean);
        });
        if (!icons) throw new Error('ключи ICONS времени суток пропали из catalog.js');
        /* границы dayPart 5/11/17/23 не изменились (доступ через тестовый крюк, без рендера) */
        const dp = await page.evaluate(function () {
            const g = window.__gym;
            const at = function (t) { return g.dayPart({ started: '2026-01-01T' + t }).i; };
            return {
                m0: at('04:59:00'), m1: at('05:00:00'),
                d0: at('10:59:00'), d1: at('11:00:00'),
                e0: at('16:59:00'), e1: at('17:00:00'),
                n0: at('22:59:00'), n1: at('23:00:00')
            };
        });
        const map = { m0: 'moon', m1: 'sunrise', d0: 'sunrise', d1: 'sun', e0: 'sun', e1: 'evening', n0: 'evening', n1: 'moon' };
        for (const k in map) {
            if (dp[k] !== map[k]) throw new Error('dayPart ' + k + ': ' + dp[k] + ', ожидалось ' + map[k]);
        }
    });

    test('[UX-T22] backbar активной: Удалить/Завершить/Назад, «Удалить» спрашивает подтверждение', async ({ page }) => {
        await openApp(page);
        await startWorkoutUi(page);
        await expect(page.locator('.backbar .btn')).toHaveCount(3, { timeout: 5000 });
        /* «💾 Сохранить» убрана (автосейв при выходе), ✕/✓ из шапки переехали вниз */
        await expect(page.locator('.backbar', { hasText: 'Сохранить' })).toHaveCount(0);
        await expect(page.locator('.wcicons .barebtn')).toHaveCount(1); /* [UX-T23] только ⏱ Время */
        const del = page.locator('.backbar [data-act="confirmModal"]');
        await expect(del).toHaveCount(1);
        await expect(del).toContainText('Удалить');
        await del.click();
        await expect(page.locator('.modal.open')).toContainText('Удалить тренировку?', { timeout: 5000 });
        await page.locator('.modal.open [data-act="confirmYes"]').click();
        await expect(page.locator('#app .hero', { hasText: 'Пока пусто' })).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.pcard')).toHaveCount(0);
    });

    test('[UX-T23] завершённая из истории: шапка 1 иконка (⏱), backbar Удалить/Повторить/Назад', async ({ page, request }) => {
        const today = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            workouts: [doneWorkout(1, today, EX, '100', 3)]
        } } });
        await openApp(page);
        await page.locator('.pcard').first().click();
        await expect(page.locator('.wcicons').first()).toBeVisible({ timeout: 5000 });
        /* [UX-T23] шапка завершённой — ровно 1 иконка ⏱ Время (← 🔁 💾 🗑 убраны) */
        const acts = await page.locator('.wcicons .barebtn').evaluateAll(function (els) {
            return els.map(function (el) { return el.getAttribute('data-act'); });
        });
        if (JSON.stringify(acts) !== JSON.stringify(['timeModal'])) {
            throw new Error('иконки шапки завершённой: ' + JSON.stringify(acts) + ', ожидалось [timeModal]');
        }
        for (const label of ['Назад', 'Повторить', 'Сохранить', 'Удалить']) {
            await expect(page.locator('.wcicons .barebtn[aria-label="' + label + '"]')).toHaveCount(0);
        }
        /* [UX-T23] нижний backbar: 🗑 Удалить c confirm · ↻ Повторить (НЕ prime) · ← Назад */
        const bbActs = await page.locator('.backbar .btn').evaluateAll(function (els) {
            return els.map(function (el) { return el.getAttribute('data-act'); });
        });
        if (JSON.stringify(bbActs) !== JSON.stringify(['confirmModal', 'newRepeatFrom', 'closeHistory'])) {
            throw new Error('кнопки backbar завершённой: ' + JSON.stringify(bbActs) + ', ожидалось [confirmModal, newRepeatFrom, closeHistory]');
        }
        const rep = page.locator('.backbar [data-act="newRepeatFrom"]');
        await expect(rep).not.toHaveClass(/prime/); /* Повторить НЕ жёлтая */
        await expect(rep).toHaveClass(/sec/);
        await expect(rep).toContainText('Повторить');
        await expect(page.locator('.backbar [data-act="confirmModal"]')).toContainText('Удалить');
        await expect(page.locator('.backbar [data-act="closeHistory"]')).toContainText('Назад');
        /* 💾 «Сохранить» исчезла — сохранение только автосейвом при выходе */
        await expect(page.locator('.backbar', { hasText: 'Сохранить' })).toHaveCount(0);
        /* большой красной «🗑 Удалить тренировку» в потоке карточки нет */
        await expect(page.locator('.card .btnrow .btn.danger')).toHaveCount(0);
        /* ← «Назад» закрывает карточку без модалки и без backbar */
        await page.locator('.backbar [data-act="closeHistory"]').click();
        await expect(page.locator('.pcard').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.backbar')).toHaveCount(0);
        /* 🗑 «Удалить» с подтверждением «Удалить тренировку?» реально удаляет */
        await page.locator('.pcard').first().click();
        await expect(page.locator('.backbar [data-act="confirmModal"]')).toBeVisible({ timeout: 5000 });
        await page.locator('.backbar [data-act="confirmModal"]').click();
        await expect(page.locator('.modal.open')).toContainText('Удалить тренировку?', { timeout: 5000 });
        await page.locator('.modal.open [data-act="confirmYes"]').click();
        await expect(page.locator('#app .hero', { hasText: 'Пока пусто' })).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.pcard')).toHaveCount(0);
    });

    test('[UX-T23] «Повторить» внизу завершённой создаёт копию: незавершённая с упражнениями и планом', async ({ page, request }) => {
        const today = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            workouts: [doneWorkout(1, today, EX, '100', 3)]
        } } });
        await openApp(page);
        await page.locator('.pcard').first().click();
        await expect(page.locator('.backbar [data-act="newRepeatFrom"]')).toBeVisible({ timeout: 5000 });
        await page.locator('.backbar [data-act="newRepeatFrom"]').click();
        /* тост повтора + сразу открытая карточка новой тренировки с backbar активной */
        await expect(page.locator('.toast.show')).toHaveText('🔁 Повтор прошлой тренировки: 1 упражнение', { timeout: 5000 });
        await expect(page.locator('.backbar', { hasText: 'Завершить' })).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.expill .exname')).toHaveText(EX);
        await expect(page.locator('.expill .entry')).toHaveCount(0); /* записи пустые — копия плана, не лога */
        /* копия реально на сервере: новая незавершённая тренировка с тем же упражнением и планом */
        const st = await (await request.get('/api/state')).json();
        const list = (st.workouts || []).filter(function (w) { return !w.finished; });
        if (list.length !== 1) throw new Error('повтор создал не одну активную тренировку: ' + JSON.stringify(st.workouts));
        const fresh = list[0];
        if (fresh.id === 1) throw new Error('повтор не создал новую тренировку, а открыл старую');
        const e0 = (fresh.exercises || [])[0];
        if (!e0 || e0.name !== EX || e0.pw !== '100' || e0.ps !== 3) {
            throw new Error('копия упражнения с планом не создалась: ' + JSON.stringify(e0));
        }
        /* исходная завершённая на месте */
        const fin = (st.workouts || []).filter(function (w) { return w.finished; });
        if (fin.length !== 1 || fin[0].id !== 1) throw new Error('исходная тренировка пропала: ' + JSON.stringify(fin));
    });

    test('[UX-T23] автосейв при выходе завершённой: правка не теряется при сбое сети и доезжает после восстановления', async ({ page, request }) => {
        let failSave = true;
        await page.route('**/api/save', function (route) {
            if (failSave) route.abort();
            else route.fallback();
        });
        const today = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            workouts: [doneWorkout(1, today, EX, '100', 3)]
        } } });
        await openApp(page);
        await page.locator('.pcard').first().click();
        await expect(page.locator('.backbar [data-act="closeHistory"]')).toBeVisible({ timeout: 5000 });
        /* правка существующей записи завершённой: save падает — блок заменён только локально */
        await page.locator('.expill .entry').first().click();
        await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 });
        await page.locator('#mWeight').fill('120');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await expect(page.locator('.expill .entry').first()).toContainText('120 кг', { timeout: 5000 });
        /* выход через нижний «← Назад»: dirty-автосейв тоже падает — карточка НЕ закрывается */
        await page.locator('.backbar [data-act="closeHistory"]').click();
        await expect(page.locator('.toast.show.err')).toContainText('Ошибка сохранения', { timeout: 5000 });
        await expect(page.locator('.backbar')).toBeVisible({ timeout: 5000 });
        /* сеть восстановилась: повторный выход сохраняет правку и закрывает карточку */
        failSave = false;
        await page.waitForTimeout(500); /* дедуп клика 400 мс — ждем окно */
        await page.locator('.backbar [data-act="closeHistory"]').click();
        await expect(page.locator('.backbar')).not.toBeVisible({ timeout: 5000 });
        const st = await (await request.get('/api/state')).json();
        const fin = (st.workouts || []).filter(function (w) { return w.finished; })[0];
        const s0 = fin && fin.exercises && fin.exercises[0] && fin.exercises[0].sets[0];
        if (!s0 || s0.w !== '120') throw new Error('автосейв завершённой не спас правку: ' + JSON.stringify(s0));
    });

    test('[UX-T23] ⏱ в шапке завершённой открывает модалку времени: правка начала/окончания сохраняется', async ({ page, request }) => {
        let failSave = false;
        await page.route('**/api/save', function (route) {
            if (failSave) route.abort();
            else route.fallback();
        });
        const today = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            workouts: [doneWorkout(1, today, EX, '100', 3)]
        } } });
        await openApp(page);
        await page.locator('.pcard').first().click();
        /* единственное действие в шапке завершённой живое: ⏱ открывает модалку времени */
        await page.locator('.wcicons [data-act="timeModal"]').click();
        await expect(page.locator('.modal.open #mStartTime')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.modal.open #mStartTime')).toHaveValue('09:30');
        await page.locator('#mStartTime').fill('0700');
        await page.locator('#mEndTime').fill('0800');
        /* [UX-T28] сбой сети при saveTime: модалка НЕ закрывается, введённые значения
           остаются в полях для повтора (тост ошибки — от doSave) */
        failSave = true;
        await page.locator('[data-act="saveTime"]').click();
        await expect(page.locator('.toast.show.err')).toContainText('Ошибка сохранения', { timeout: 5000 });
        await expect(page.locator('.modal.open #mStartTime')).toBeVisible();
        await expect(page.locator('.modal.open #mStartTime')).toHaveValue('07:00');
        await expect(page.locator('.modal.open #mEndTime')).toHaveValue('08:00');
        /* сеть восстановилась: повторное сохранение закрывает модалку, время на сервере */
        failSave = false;
        await page.waitForTimeout(500); /* дедуп клика 400 мс — ждем окно */
        await page.locator('[data-act="saveTime"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        /* saveTime сохраняет сам: правка на сервере ещё при открытой карточке */
        const st = await (await request.get('/api/state')).json();
        const fin = (st.workouts || []).filter(function (w) { return w.finished; })[0];
        if (!fin || String(fin.started).slice(11, 16) !== '07:00' || String(fin.ended).slice(11, 16) !== '08:00') {
            throw new Error('время завершённой не сохранилось: ' + JSON.stringify(fin));
        }
        /* [FIT-S2] у завершённой метрики в плитках карты: 07:00–08:00 = «1 ч» */
        await expect(page.locator('.mapcard')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.statgrid.map3 .sg', { hasText: 'Продолжительность' })).toContainText('1 ч', { timeout: 5000 });
    });

    test('[UX-T23] таймер отдыха поднимается над backbar завершённой карточки (restRaised)', async ({ page, request }) => {
        /* остаток таймера кладём напрямую в localStorage (тест-сетап, §1.7) */
        await page.addInitScript(function () {
            try {
                localStorage.setItem('gymRest', JSON.stringify({ end: Date.now() + 60000, dur: 90, paused: false, mini: false, ex: 'Жим штанги лёжа' }));
            } catch (e) { /* noop */ }
        });
        const today = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            workouts: [doneWorkout(1, today, EX, '100', 3)]
        } } });
        await openApp(page);
        const bar = page.locator('#restbar');
        await expect(bar.locator('#rbTime')).toBeVisible({ timeout: 5000 });
        /* на списке истории backbar нет — панель у нижней навигации, без raised */
        const listRaised = await bar.evaluate(function (el) { return el.classList.contains('raised'); });
        if (listRaised) throw new Error('на списке истории restbar получил класс raised');
        /* открытая завершённая карточка имеет свой backbar — панель обязана подняться выше [UX-T23] */
        await page.locator('.pcard').first().click();
        await expect(page.locator('.backbar [data-act="closeHistory"]')).toBeVisible({ timeout: 5000 });
        await expect(bar).toHaveClass(/raised/, { timeout: 5000 });
        /* геометрия: низ панели не ниже верха backbar — кнопки Удалить/Повторить/Назад не перекрыты */
        const g = await bar.evaluate(function (el) {
            const bb = document.querySelector('.backbar');
            const b = el.getBoundingClientRect(), t = bb.getBoundingClientRect();
            return { barBottom: Math.round(b.bottom), backTop: Math.round(t.top) };
        });
        if (g.barBottom > g.backTop + 1) throw new Error('restbar перекрывает backbar завершённой: ' + JSON.stringify(g));
        /* закрыли карточку — панель вернулась к навигации */
        await page.locator('.backbar [data-act="closeHistory"]').click();
        await expect(page.locator('.pcard').first()).toBeVisible({ timeout: 5000 });
        await expect(bar).not.toHaveClass(/raised/);
    });

    test('звезда в списке «Техника»: у правого края строки, тоглится, сохраняется на сервере (favs) и не открывает упражнение', async ({ page, request }) => {
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Техника' }).click();
        const card = page.locator('#techList .excard', { hasText: EX }).first();
        const star = card.locator('.star');
        await expect(star).toBeVisible({ timeout: 5000 });
        await expect(star).toHaveAttribute('aria-label', 'В любимые');
        /* [UX-T20] звезда прижата к правому краю строки: зазор справа = паддинг карточки (~11px) */
        const geom = await card.evaluate(function (el) {
            const c = el.getBoundingClientRect();
            const s = el.querySelector('.star').getBoundingClientRect();
            return { cardRight: c.right, starRight: s.right, h: s.height };
        });
        const gap = geom.cardRight - geom.starRight;
        if (gap > 16) throw new Error('звезда не у правого края строки: зазор ' + gap.toFixed(1) + 'px');
        if (geom.h < 28) throw new Error('тап-зона звезды слишком мала: ' + geom.h.toFixed(1) + 'px');
        await star.click();
        /* тап по звезде НЕ открыл упражнение: остались список и заголовок «Техника» */
        await expect(page.locator('.tb-title')).toContainText('Техника', { timeout: 5000 });
        await expect(page.locator('#techList')).toBeVisible();
        const star2 = page.locator('#techList .excard', { hasText: EX }).first().locator('.star');
        await expect(star2).toHaveClass(/fav/, { timeout: 5000 });
        await expect(star2).toHaveAttribute('aria-label', 'Из любимых');
        /* сохранено на сервере (favs) [EXR-T13] */
        await expect.poll(async function () {
            const r = await request.get('/api/state');
            const j = await r.json();
            return (j.favs || []).join(',');
        }, { timeout: 8000 }).toContain(EX);
        /* переживает перезагрузку (после reload приложение открывается на «Истории») */
        await page.reload();
        await page.locator('.nav button', { hasText: 'Техника' }).click();
        await expect(page.locator('#techList .excard', { hasText: EX }).first().locator('.star')).toHaveClass(/fav/, { timeout: 10000 });
    });

    test('центровка глифов в 4 кнопках панели таймера: центр кнопки = центр глифа ±2px', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await fillEntry(page, '60', '1', '10');
        const bar = page.locator('#restbar');
        await expect(bar.locator('#rbTime')).toBeVisible({ timeout: 5000 });
        const res = await page.evaluate(function () {
            function glyphCenter(btn) {
                const r = document.createRange();
                r.selectNodeContents(btn);
                const b = r.getBoundingClientRect();
                return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
            }
            const out = [];
            document.querySelectorAll('.rb-sqbtn').forEach(function (b) {
                const bb = b.getBoundingClientRect();
                const g = glyphCenter(b);
                out.push({ act: b.getAttribute('data-act'), dx: Math.abs((bb.x + bb.width / 2) - g.x), dy: Math.abs((bb.y + bb.height / 2) - g.y) });
            });
            return out;
        });
        if (res.length !== 4) throw new Error('кнопок таймера: ' + res.length + ', ожидалось 4');
        for (const r of res) {
            if (r.dx > 2 || r.dy > 2) {
                throw new Error('кнопка ' + r.act + ' не по центру: dx=' + r.dx.toFixed(1) + 'px, dy=' + r.dy.toFixed(1) + 'px');
            }
        }
    });
});

/* ===== [EXR-T4] фильтры-мультивыбор «Техники»: шиты мышц/инвентаря, одиночные категории,
   «Своё» поверх фильтров, пустой результат + сброс. Матчинг тегов работает в обеих схемах
   каталога (новая tags с префиксами m:/e:/cat: и legacy плоские t) — через фолбэк exTagMatch ===== */
test.describe('EXR-T4: фильтры-мультивыбор «Техники»', function () {

    test('шит «Группы мышц»: чекбоксы, счётчик, применить закрывает с сохранением', async ({ page }) => {
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Техника' }).click();
        await page.locator('.card .secrow .chip', { hasText: 'Группы мышц' }).click();
        const sheet = page.locator('.modal.open');
        await sheet.waitFor({ state: 'visible', timeout: 5000 });
        /* 8 групп мышц чекбоксами */
        const rows = await sheet.locator('.frow').allTextContents();
        if (rows.length !== 8) throw new Error('в шите мышц ' + rows.length + ' строк, ожидалось 8');
        await sheet.locator('.frow', { hasText: 'Грудь' }).click();
        await expect(sheet.locator('.frow', { hasText: 'Грудь' })).toHaveClass(/on/, { timeout: 5000 });
        /* счётчик в шапке шита растёт без перерисовки модалки */
        await expect(sheet.locator('#sheetCnt')).toHaveText('1', { timeout: 5000 });
        await sheet.locator('.frow', { hasText: 'Спина' }).click();
        await expect(sheet.locator('#sheetCnt')).toHaveText('2', { timeout: 5000 });
        /* «Применить» закрывает шит, выбор сохраняется: чип подсвечен + счётчик 2 */
        await sheet.locator('.btnrow .btn', { hasText: 'Применить' }).click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        const chip = page.locator('.card .secrow .chip', { hasText: 'Группы мышц' });
        await expect(chip).toHaveClass(/on/, { timeout: 5000 });
        await expect(chip).toContainText('2');
        /* фильтр применился: только грудь+спина */
        await expect(page.locator('#techList .excard', { hasText: 'Жим штанги лёжа' }).first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#techList .excard', { hasText: 'Приседания со штангой' })).toHaveCount(0);
    });

    /* [EXR] гибрид B→A: живой счётчик результатов на «Применить» шита — обновляется при
       каждом тапе чекбокса до закрытия. Фактические числа каталога: Спина = 24,
       Спина+Ягодицы (ИЛИ внутри группы) = 56 из 243 */
    test('гибрид фильтров: счётчик на «Применить» шита мышц (Спина → +Ягодицы)', async ({ page }) => {
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Техника' }).click();
        const total = await page.locator('#techList .excard').count();
        await page.locator('.card .secrow .chip', { hasText: 'Группы мышц' }).click();
        const sheet = page.locator('.modal.open');
        await sheet.waitFor({ state: 'visible', timeout: 5000 });
        const applyBtn = sheet.locator('#sheetApply');
        /* при открытии (ничего не выбрано) счётчик = весь каталог */
        await expect(applyBtn).toHaveText('Применить · ' + total, { timeout: 5000 });
        /* тап «Спина» → «Применить · N», N — спинные записи каталога */
        await sheet.locator('.frow', { hasText: 'Спина' }).click();
        await expect(applyBtn).toHaveText(/^Применить · \d+$/, { timeout: 5000 });
        const nBack = parseInt((await applyBtn.textContent()).replace(/\D+/g, ''), 10);
        if (!(nBack > 0 && nBack < total)) throw new Error('счётчик «Спина» = ' + nBack + ' из ' + total);
        /* обещанное число = фактический список после применения */
        await applyBtn.click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        const visible = await page.locator('#techList .excard').count();
        if (visible !== nBack) throw new Error('после применения ' + visible + ' карточек, счётчик обещал ' + nBack);
        /* повторное открытие шита: Спина ещё выбрана; тап «Ягодицы» → число выросло (ИЛИ внутри группы) */
        await page.locator('.card .secrow .chip', { hasText: 'Группы мышц' }).click();
        await expect(applyBtn).toHaveText('Применить · ' + nBack, { timeout: 5000 });
        await sheet.locator('.frow', { hasText: 'Ягодицы' }).click();
        await expect(applyBtn).toHaveText(/^Применить · \d+$/, { timeout: 5000 });
        const nGl = parseInt((await applyBtn.textContent()).replace(/\D+/g, ''), 10);
        if (nGl <= nBack) throw new Error('счётчик не вырос после «Ягодицы»: ' + nGl + ' (Спина была ' + nBack + ')');
        if (nGl > total) throw new Error('счётчик «Спина+Ягодицы» = ' + nGl + ' больше каталога ' + total);
    });

    test('гибрид фильтров: 0 результатов → «Применить» без числа', async ({ page }) => {
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Техника' }).click();
        await page.locator('.card .secrow .chip', { hasText: 'Разминка и заминка' }).click();
        const warm = await page.locator('#techList .excard').count();
        if (warm < 1) throw new Error('разминка пуста');
        await page.locator('.card .secrow .chip', { hasText: 'Группы мышц' }).click();
        const sheet = page.locator('.modal.open');
        await sheet.waitFor({ state: 'visible', timeout: 5000 });
        /* открытие шита поверх активного фильтра: счётчик = разминка/заминка */
        await expect(sheet.locator('#sheetApply')).toHaveText('Применить · ' + warm, { timeout: 5000 });
        /* И между группами: у разминки нет мышц (chest∩warm = 0) → 0 → «Применить» без числа */
        await sheet.locator('.frow', { hasText: 'Грудь' }).click();
        await expect(sheet.locator('#sheetApply')).toHaveText('Применить', { timeout: 5000 });
    });

    test('мультивыбор мышц: Грудь + Спина → ИЛИ внутри группы', async ({ page }) => {
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Техника' }).click();
        await page.locator('.card .secrow .chip', { hasText: 'Группы мышц' }).click();
        const sheet = page.locator('.modal.open');
        await sheet.locator('.frow', { hasText: 'Грудь' }).click();
        await sheet.locator('.frow', { hasText: 'Спина' }).click();
        await sheet.locator('.btnrow .btn', { hasText: 'Применить' }).click();
        /* ИЛИ: видны и жимы (грудь), и подтягивания (спина); ноги не выбраны — присед скрыт */
        await expect(page.locator('#techList .excard', { hasText: 'Жим штанги лёжа' }).first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#techList .excard', { hasText: 'Подтягивания' }).first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#techList .excard', { hasText: 'Приседания со штангой' })).toHaveCount(0);
        /* выбранные значения — строка мини-чипов с × */
        await expect(page.locator('.fchip', { hasText: 'Грудь' })).toBeVisible();
        await expect(page.locator('.fchip', { hasText: 'Спина' })).toBeVisible();
    });

    test('инвентарь + мышца: И между группами; подзаголовки инвентаря в шите', async ({ page }) => {
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Техника' }).click();
        await page.locator('.card .secrow .chip', { hasText: 'Инвентарь' }).click();
        const sheet = page.locator('.modal.open');
        await sheet.waitFor({ state: 'visible', timeout: 5000 });
        /* 5 подзаголовков подгрупп инвентаря [EXR-T4]: «Брусья и турник» — последняя (ревью PR #212) */
        const subs = await sheet.locator('.msub').allTextContents();
        if (JSON.stringify(subs) !== JSON.stringify(['Свободные веса', 'Тренажёры', 'Мелкий инвентарь', 'Без инвентаря', 'Брусья и турник'])) {
            throw new Error('подзаголовки инвентаря: ' + JSON.stringify(subs));
        }
        await sheet.locator('.frow', { hasText: 'Штанга' }).click();
        await sheet.locator('.btnrow .btn', { hasText: 'Применить' }).click();
        await expect(page.locator('.card .secrow .chip', { hasText: 'Инвентарь' })).toHaveClass(/on/, { timeout: 5000 });
        await expect(page.locator('#techList .excard', { hasText: 'Жим штанги лёжа' }).first()).toBeVisible({ timeout: 5000 });
        /* поверх — группа мышц: остаётся только штанга на грудь */
        await page.locator('.card .secrow .chip', { hasText: 'Группы мышц' }).click();
        await page.locator('.modal.open .frow', { hasText: 'Грудь' }).click();
        await page.locator('.modal.open .btnrow .btn', { hasText: 'Применить' }).click();
        await expect(page.locator('#techList .excard', { hasText: 'Жим штанги лёжа' }).first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#techList .excard', { hasText: 'Жим в наклоне' }).first()).toBeVisible({ timeout: 5000 });
        /* гантельный жим тоже на грудь, но инвентарь не штанга — скрыт */
        await expect(page.locator('#techList .excard', { hasText: 'Жим гантелей лёжа' })).toHaveCount(0);
        await expect(page.locator('#techList .excard', { hasText: 'Подтягивания' })).toHaveCount(0);
    });

    test('кардио-чип: одиночная категория вкл/выкл', async ({ page }) => {
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Техника' }).click();
        const total = await page.locator('#techList .excard').count();
        const chip = page.locator('.card .secrow .chip', { hasText: 'Кардио' });
        await chip.click();
        await expect(chip).toHaveClass(/on/, { timeout: 5000 });
        const cardio = await page.locator('#techList .excard').count();
        if (cardio < 1 || cardio >= total) throw new Error('кардио-чип: ' + cardio + ' из ' + total + ' — фильтр не сработал');
        await expect(page.locator('#techList .excard', { hasText: 'Кардио-разминка' }).first()).toBeVisible({ timeout: 5000 });
        /* повторный тап выключает */
        await chip.click();
        await expect(chip).not.toHaveClass(/on/, { timeout: 5000 });
        const restored = await page.locator('#techList .excard').count();
        if (restored !== total) throw new Error('после выключения список не восстановился: ' + restored + ' из ' + total);
    });

    test('«Своё» поверх фильтров: свои упражнения без категории', async ({ page, request }) => {
        /* сеем своё упражнение на сервере до входа — /api/init читает при рендере [EXR-T13] */
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [], workouts: [], customEx: [{ n: 'Моё упражнение', tags: [] }] } } });
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Техника' }).click();
        await page.locator('.card .secrow .chip', { hasText: 'Своё' }).click();
        await expect(page.locator('.card .secrow .chip', { hasText: 'Своё' })).toHaveClass(/on/, { timeout: 5000 });
        const own = page.locator('#techList .excard', { hasText: 'Моё упражнение' });
        await expect(own).toHaveCount(1, { timeout: 5000 });
        await expect(own.locator('.extags')).toHaveText('#своё');
        /* тег-фильтры к «Своим» не применяются — карточка остаётся видимой */
        await page.locator('.card .secrow .chip', { hasText: 'Кардио' }).click();
        await expect(page.locator('#techList .excard', { hasText: 'Моё упражнение' })).toHaveCount(1, { timeout: 5000 });
        /* своя карточка не открывает экран техники (нет каталог-записи) */
        await own.click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await expect(page.locator('#techList .excard', { hasText: 'Моё упражнение' })).toHaveCount(1);
        /* возврат в режим каталога снова применяет фильтры */
        await page.locator('.card .secrow .chip', { hasText: 'Все' }).click();
        await expect(page.locator('#techList .excard', { hasText: 'Моё упражнение' })).toHaveCount(0, { timeout: 5000 });
        await expect(page.locator('#techList .excard', { hasText: 'Кардио-разминка' }).first()).toBeVisible({ timeout: 5000 });
    });

    test('пустой результат: Трицепс + Разминка и заминка → «Ничего не найдено» + сброс', async ({ page }) => {
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Техника' }).click();
        const total = await page.locator('#techList .excard').count();
        await page.locator('.card .secrow .chip', { hasText: 'Группы мышц' }).click();
        await page.locator('.modal.open .frow', { hasText: 'Трицепс' }).click();
        await page.locator('.modal.open .btnrow .btn', { hasText: 'Применить' }).click();
        await page.locator('.card .secrow .chip', { hasText: 'Разминка и заминка' }).click();
        /* сочетание пустое: сообщение + кнопка сброса */
        await expect(page.locator('.empty', { hasText: 'Ничего не найдено' })).toBeVisible({ timeout: 5000 });
        await page.locator('.empty [data-act="techResetFilters"]').click();
        /* сброс: режим «Все», фильтры и счётчики очищены, список восстановлен */
        await expect(page.locator('.card .secrow .chip', { hasText: 'Все' })).toHaveClass(/on/, { timeout: 5000 });
        await expect(page.locator('.card .secrow .chip', { hasText: 'Разминка и заминка' })).not.toHaveClass(/on/, { timeout: 5000 });
        await expect(page.locator('.card .secrow .chip', { hasText: 'Группы мышц' })).not.toHaveClass(/on/, { timeout: 5000 });
        await expect(page.locator('.fchip')).toHaveCount(0);
        const restored = await page.locator('#techList .excard').count();
        if (restored !== total) throw new Error('после сброса список не восстановился: ' + restored + ' из ' + total);
    });

    test('сброс по одному: × на мини-чипе и «Сбросить группу»', async ({ page }) => {
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Техника' }).click();
        await page.locator('.card .secrow .chip', { hasText: 'Группы мышц' }).click();
        await page.locator('.modal.open .frow', { hasText: 'Грудь' }).click();
        await page.locator('.modal.open .frow', { hasText: 'Спина' }).click();
        await page.locator('.modal.open .btnrow .btn', { hasText: 'Применить' }).click();
        /* убираем «Грудь» крестиком — остаётся только «Спина» */
        await page.locator('.fchip', { hasText: 'Грудь' }).locator('.fchip-x').click();
        await expect(page.locator('.fchip')).toHaveCount(1, { timeout: 5000 });
        await expect(page.locator('.card .secrow .chip', { hasText: 'Группы мышц' })).toContainText('1');
        await expect(page.locator('#techList .excard', { hasText: 'Жим штанги лёжа' })).toHaveCount(0, { timeout: 5000 });
        await expect(page.locator('#techList .excard', { hasText: 'Подтягивания' }).first()).toBeVisible({ timeout: 5000 });
        /* «Сбросить группу» снимает фильтр целиком */
        await page.locator('.fclear', { hasText: 'Сбросить группу' }).click();
        await expect(page.locator('.fchip')).toHaveCount(0, { timeout: 5000 });
        await expect(page.locator('.card .secrow .chip', { hasText: 'Группы мышц' })).not.toHaveClass(/on/);
        await expect(page.locator('#techList .excard', { hasText: 'Жим штанги лёжа' }).first()).toBeVisible({ timeout: 5000 });
    });

    test('✕ шита закрывает без потери выбора; повторное открытие показывает отмеченное', async ({ page }) => {
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Техника' }).click();
        await page.locator('.card .secrow .chip', { hasText: 'Инвентарь' }).click();
        await page.locator('.modal.open .frow', { hasText: 'Гантели' }).click();
        /* ✕ в шапке шита — тот же techApplyFilters: закрыть и сохранить */
        await page.locator('.modal.open .mtitle-row .barebtn').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await expect(page.locator('.card .secrow .chip', { hasText: 'Инвентарь' })).toHaveClass(/on/, { timeout: 5000 });
        await expect(page.locator('.fchip', { hasText: 'Гантели' })).toBeVisible();
        await page.locator('.card .secrow .chip', { hasText: 'Инвентарь' }).click();
        await expect(page.locator('.modal.open .frow', { hasText: 'Гантели' })).toHaveClass(/on/, { timeout: 5000 });
        await expect(page.locator('.modal.open #sheetCnt')).toHaveText('1');
        await page.locator('.modal.open .btnrow .btn', { hasText: 'Применить' }).click();
        await expect(page.locator('#techList .excard', { hasText: 'Жим гантелей лёжа' }).first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#techList .excard', { hasText: 'Жим штанги лёжа' })).toHaveCount(0);
    });

    test('фон-закрытие шита обновляет чипы-счётчики и мини-чипы [EXR-T4 fix]', async ({ page }) => {
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Техника' }).click();
        await page.locator('.card .secrow .chip', { hasText: 'Группы мышц' }).click();
        await page.locator('.modal.open .frow', { hasText: 'Грудь' }).click();
        /* тап по фону (вне modal-box) закрывает шит — экран должен перерисоваться */
        await page.locator('#modal').click({ position: { x: 5, y: 5 } });
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        const chip = page.locator('.card .secrow .chip', { hasText: 'Группы мышц' });
        await expect(chip).toHaveClass(/on/, { timeout: 5000 });
        await expect(chip).toContainText('1');
        await expect(page.locator('.fchip', { hasText: 'Грудь' })).toBeVisible();
        await expect(page.locator('#techList .excard', { hasText: 'Приседания со штангой' })).toHaveCount(0);
    });
});

/* ===== [UX-T19→EXR-T4] чипы «Техники»: режимы + фильтры-мультивыбор, назад на вкладку-источник, профиль одним рядом ===== */
test.describe('UX-T19/T23 + EXR-T4: чипы «Техники», топбар, профиль одним рядом', function () {

    test('чипы «Техники» [EXR-T4]: режимы ★ Любимые · Своё · Все · Коллекции + ряд фильтров; «Все» активен по умолчанию', async ({ page }) => {
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Техника' }).click();
        await expect(page.locator('.tb-title')).toContainText('Техника', { timeout: 5000 });
        /* порядок режимов [EXR-T4] (вместо прежних «Вид · Блок · Мышцы») */
        const texts = await page.locator('.card .secrow').first().locator('.chip').allTextContents();
        const expected = ['★ Любимые', 'Своё', 'Все', 'Коллекции'];
        if (JSON.stringify(texts) !== JSON.stringify(expected)) {
            throw new Error('порядок режимов: ' + JSON.stringify(texts) + ', ожидалось ' + JSON.stringify(expected));
        }
        /* ряд фильтров: группы-мультивыбор + одиночные категории [EXR-T4] */
        const ftexts = await page.locator('.card .secrow').nth(1).locator('.chip').allTextContents();
        const fexpected = ['Группы мышц', 'Инвентарь', 'Кардио', 'Растяжка', 'Разминка и заминка', 'Стретчинг'];
        if (JSON.stringify(ftexts) !== JSON.stringify(fexpected)) {
            throw new Error('порядок фильтров: ' + JSON.stringify(ftexts) + ', ожидалось ' + JSON.stringify(fexpected));
        }
        /* «Все» — режим по умолчанию: активен, весь каталог на входе, без «Ничего не найдено» */
        await expect(page.locator('.card .secrow .chip', { hasText: 'Все' })).toHaveClass(/on/, { timeout: 5000 });
        const total = await page.locator('#techList .excard').count();
        if (total < 60) throw new Error('на входе «Техника» показывает ' + total + ' упражнений, ожидался весь каталог');
        await expect(page.locator('.empty')).toHaveCount(0);
        /* пустой favourites-набор даёт понятное пустое состояние [EXR-T15 §8, Э7] */
        await page.locator('.card .secrow .chip', { hasText: '★ Любимые' }).click();
        await expect(page.locator('.empty', { hasText: 'В Любимых пока пусто' })).toHaveCount(1, { timeout: 5000 });
        await page.locator('.card .secrow .chip', { hasText: 'Все' }).click();
        await expect(page.locator('.empty')).toHaveCount(0);
        await expect(page.locator('#techList .excard').first()).toBeVisible();
        /* повторный вход через навигацию снова открывает «Все» — фильтры сброшены [EXR-T4] */
        await page.locator('.card .secrow .chip', { hasText: 'Кардио' }).click();
        await expect(page.locator('.card .secrow .chip', { hasText: 'Кардио' })).toHaveClass(/on/, { timeout: 5000 });
        const filtered = await page.locator('#techList .excard').count();
        if (filtered >= total) throw new Error('кардио-чип не отфильтровал: ' + filtered + ' >= ' + total);
        await page.locator('.nav button', { hasText: 'История' }).click();
        await page.locator('.nav button', { hasText: 'Техника' }).click();
        await expect(page.locator('.card .secrow .chip', { hasText: 'Все' })).toHaveClass(/on/, { timeout: 5000 });
        await expect(page.locator('.card .secrow .chip', { hasText: 'Кардио' })).not.toHaveClass(/on/, { timeout: 5000 });
        const restored = await page.locator('#techList .excard').count();
        if (restored !== total) throw new Error('после возврата список не восстановился: ' + restored + ' из ' + total);
    });

    test('[UX-T23] topbar без стрелки «←» на чистых вкладках: заголовок «<вкладка>» и шестерёнка настроек [UX-T27]', async ({ page }) => {
        await openApp(page);
        /* кнопки «Назад» (tb-back/goBack) нет ни на одной вкладке; вкладка profile снова «Профиль» */
        for (const label of ['История', 'Статистика', 'Техника', 'Профиль']) {
            await page.locator('.nav button', { hasText: label }).click();
            await expect(page.locator('.tb-title')).toContainText(label, { timeout: 5000 });
            await expect(page.locator('.topbar [data-act="goBack"]')).toHaveCount(0);
            await expect(page.locator('.topbar .tb-back')).toHaveCount(0);
        }
        /* топбар — заголовок + пара [ 📅 ][ ⚙ ]: с ред. 5 [ONB] пара обёрнута в носитель
           .tbpair (спотлайт туториала вкладывается в него, экранных координат нет) */
        const parts = await page.locator('.topbar').evaluate(function (bar) {
            return Array.prototype.slice.call(bar.children).map(function (el) {
                return (el.classList.contains('tb-title') ? 'title' : '') +
                    (el.classList.contains('tb-user') ? 'user' : '') +
                    (el.classList.contains('tbpair') ? 'tbpair' : '');
            }).join(',');
        });
        if (parts !== 'title,tbpair') throw new Error('состав topbar: ' + parts + ', ожидалось title,tbpair');
        const pairBtns = await page.locator('.topbar .tbpair .tb-user').evaluateAll(function (btns) {
            return btns.map(function (b) { return b.getAttribute('aria-label'); }).join('|');
        });
        if (pairBtns !== 'Календарь|Настройки') throw new Error('кнопки пары topbar: ' + pairBtns);
        /* [UX-T27] кнопка шестерёнки жива: ведёт в Настройки с любой вкладки */
        await page.locator('.nav button', { hasText: 'Статистика' }).click();
        await expect(page.locator('.topbar [aria-label="Настройки"]')).toHaveCount(1);
        await page.locator('[aria-label="Настройки"]').click();
        await expect(page.locator('.tb-title')).toContainText('Настройки', { timeout: 5000 });
    });

    test('[UX-T23] возвраты: «←» в topbar карточки техники и карточки тренировки, «⭐ Любимые» из Профиля работают', async ({ page, request }) => {
        const today = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            workouts: [doneWorkout(1, today, EX, '100', 3)]
        } } });
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Техника' }).click();
        /* отмечаем жим ⭐ в списке техники — фильтр «★ Любимые» будет непустым */
        const starRow = page.locator('#techList .excard', { hasText: EX }).first().locator('.star');
        await starRow.click();
        await expect(starRow).toHaveClass(/fav/, { timeout: 5000 });
        /* открытое упражнение: возврат — «←» в topbar (techBack, эталон tb-user);
           голой стрелки «К упражнениям» в .exhead больше нет */
        await page.locator('#techList .excard', { hasText: EX }).first().click();
        await expect(page.locator('.topbar [aria-label="Назад"]')).toHaveCount(1, { timeout: 5000 });
        await expect(page.locator('.topbar [aria-label="Назад"]')).toHaveAttribute('data-act', 'techBack');
        await expect(page.locator('.exhead .barebtn')).toHaveCount(0);
        await page.locator('.topbar [data-act="techBack"]').click();
        await expect(page.locator('#techList')).toBeVisible({ timeout: 5000 });
        /* открытая карточка тренировки: «←» в topbar (closeHistory) + нижний backbar
           сохранён (решение владельца «и внизу и вверху»); выход по верхней стрелке */
        await page.locator('.nav button', { hasText: 'История' }).click();
        await page.locator('.pcard').first().click();
        await expect(page.locator('.wcicons').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.topbar [aria-label="Назад"]')).toHaveCount(1);
        await expect(page.locator('.topbar [aria-label="Назад"]')).toHaveAttribute('data-act', 'closeHistory');
        await expect(page.locator('.backbar [data-act="closeHistory"]')).toHaveCount(1);
        await page.locator('.topbar [aria-label="Назад"]').click();
        await expect(page.locator('.topbar [aria-label="Назад"]')).toHaveCount(0, { timeout: 5000 });
        /* «⭐ Любимые» из Профиля: переход на «Технику» с фильтром работает без lastTab-логики */
        await page.locator('.nav button', { hasText: 'Профиль' }).click();
        await page.locator('[data-act="openFavs"]').click();
        await expect(page.locator('.tb-title')).toContainText('Техника', { timeout: 5000 });
        await expect(page.locator('.card .secrow .chip', { hasText: '★ Любимые' })).toHaveClass(/on/, { timeout: 5000 });
        await expect(page.locator('#techList .excard', { hasText: EX })).toHaveCount(1);
    });

    test('[UX-T29] профиль: select год+месяц в одном ряду, сохранение — birth-пара и age-зеркало доезжают до сервера', async ({ page, request }) => {
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Профиль' }).click();
        const brow = page.locator('.brow');
        await expect(brow).toBeVisible({ timeout: 5000 });
        /* два select в одну строку, достаточно широкие и высотой ~40px (как поля prow) */
        const boxes = await brow.evaluate(function (row) {
            return ['#pfBirthYear', '#pfBirthMonth'].map(function (sel) {
                const r = row.querySelector(sel).getBoundingClientRect();
                return { sel: sel, cy: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
            });
        });
        const cys = boxes.map(function (b) { return b.cy; });
        if (Math.max.apply(null, cys) - Math.min.apply(null, cys) > 2) {
            throw new Error('select-ы даты не в одной строке: ' + JSON.stringify(boxes));
        }
        for (const b of boxes) {
            if (b.w < 50) throw new Error('select слишком узкий: ' + JSON.stringify(b));
            if (b.h < 38 || b.h > 44) throw new Error('высота select вне ~40px: ' + JSON.stringify(b));
        }
        /* поле «Возраст» удалено; рост/вес в одну строку */
        await expect(page.locator('#pfAge')).toHaveCount(0);
        const hc = await page.locator('.prow').evaluate(function (row) {
            const h = row.querySelector('#pfHeight').getBoundingClientRect();
            const w = row.querySelector('#pfWeight').getBoundingClientRect();
            return Math.abs((h.y + h.height / 2) - (w.y + w.height / 2));
        });
        if (hc > 2) throw new Error('рост/вес не в одной строке');
        /* выбор даты и сохранение: месяц = текущий → age-зеркало ровно 36 */
        const now = new Date();
        await page.locator('#pfBirthYear').selectOption(String(now.getFullYear() - 36));
        await page.locator('#pfBirthMonth').selectOption(String(now.getMonth() + 1));
        await page.locator('#pfHeight').fill('182');
        await page.locator('#pfWeight').fill('88.5');
        await page.locator('[data-act="saveProfile"]').click();
        await expect(page.locator('.toast.show')).toHaveText('✓ Профиль сохранён', { timeout: 5000 });
        const st = await (await request.get('/api/state')).json();
        if (!st.profile || st.profile.birthYear !== now.getFullYear() - 36 || st.profile.birthMonth !== now.getMonth() + 1
            || st.profile.age !== 36 || st.profile.height !== 182 || st.profile.weight !== 88.5) {
            throw new Error('профиль не сохранился: ' + JSON.stringify(st.profile));
        }
        /* сегмент пола на месте, без изменений */
        await expect(page.locator('.seg .seg-btn')).toHaveCount(2);
    });

    test('[UX-T20] «Пол» одной строкой: label слева, сегмент М/Ж справа; выбор сохраняется', async ({ page, request }) => {
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Профиль' }).click();
        const row = page.locator('.sexrow');
        await expect(row).toBeVisible({ timeout: 5000 });
        const g = await row.evaluate(function (el) {
            const t = el.querySelector('.t1').getBoundingClientRect();
            const s = el.querySelector('.seg').getBoundingClientRect();
            return { tCy: t.y + t.height / 2, sCy: s.y + s.height / 2, tRight: t.right, sLeft: s.left, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
        });
        /* label и сегмент — по одной оси (вертикальные центры совпадают) */
        if (Math.abs(g.tCy - g.sCy) > 4) throw new Error('«Пол» не в одну строку: расхождение центров ' + Math.abs(g.tCy - g.sCy).toFixed(1) + 'px');
        /* label слева, сегмент справа */
        if (g.sLeft < g.tRight) throw new Error('сегмент пола не правее label');
        if (g.overflow) throw new Error('строка «Пол» даёт горизонтальное переполнение');
        /* переключение пола работает, сохранение доезжает до сервера */
        await row.locator('.seg-btn', { hasText: 'Ж' }).click();
        await expect(row.locator('.seg-btn', { hasText: 'Ж' })).toHaveClass(/on/, { timeout: 5000 });
        await expect(row.locator('.seg-btn', { hasText: 'М' })).not.toHaveClass(/on/);
        /* [UX-T29] вместо поля «Возраст» — дата рождения */
        await page.locator('#pfBirthYear').selectOption('1990');
        await page.locator('#pfBirthMonth').selectOption('11');
        await page.locator('#pfHeight').fill('175');
        await page.locator('#pfWeight').fill('70');
        await page.locator('[data-act="saveProfile"]').click();
        await expect(page.locator('.toast.show')).toHaveText('✓ Профиль сохранён', { timeout: 5000 });
        const st = await (await request.get('/api/state')).json();
        if (!st.profile || st.profile.sex !== 'ж') throw new Error('пол не сохранился: ' + JSON.stringify(st.profile));
    });

    test('320px: строка «Пол» без переполнения, сегмент компактный справа', async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 640 });
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Профиль' }).click();
        await expect(page.locator('.sexrow')).toBeVisible({ timeout: 5000 });
        const m = await page.evaluate(function () {
            const el = document.querySelector('.sexrow');
            const t = el.querySelector('.t1').getBoundingClientRect();
            const s = el.querySelector('.seg').getBoundingClientRect();
            return {
                overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
                tCy: t.y + t.height / 2, sCy: s.y + s.height / 2,
                sW: s.width, sRight: s.right, cardRight: el.getBoundingClientRect().right
            };
        });
        if (m.overflow) throw new Error('переполнение строки «Пол» на 320px');
        if (Math.abs(m.tCy - m.sCy) > 4) throw new Error('на 320px «Пол» не в одну строку: ' + Math.abs(m.tCy - m.sCy).toFixed(1) + 'px');
        /* max-width 220 + 2px бордера (без глобального border-box) = 222px по boundingBox */
        if (m.sW > 224) throw new Error('сегмент пола шире ~220px: ' + m.sW.toFixed(1));
        if (m.cardRight - m.sRight > 16) throw new Error('сегмент не прижат к правому краю карточки на 320px');
    });

    test('[UX-T29] 320px: дата рождения и ряд профиля без горизонтального переполнения, кнопка компактна', async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 640 });
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Профиль' }).click();
        await expect(page.locator('.prow')).toBeVisible({ timeout: 5000 });
        const m = await page.evaluate(function () {
            const row = document.querySelector('.prow');
            const ys = document.querySelector('#pfBirthYear').getBoundingClientRect();
            const ms = document.querySelector('#pfBirthMonth').getBoundingClientRect();
            const btn = document.querySelector('.pfsave').getBoundingClientRect();
            return {
                vw: document.documentElement.clientWidth,
                overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
                btn: { y: Math.round(btn.y), w: Math.round(btn.width), h: Math.round(btn.height) },
                browOneLine: Math.abs((ys.y + ys.height / 2) - (ms.y + ms.height / 2)) <= 2,
                browW: [Math.round(ys.width), Math.round(ms.width)]
            };
        });
        if (m.overflow) throw new Error('горизонтальное переполнение на 320px: ' + JSON.stringify(m));
        /* два select в ряд сжимаются flex:1 — без перевода на вторую строку */
        if (!m.browOneLine) throw new Error('select-ы даты не в одной строке на 320px');
        for (const w of m.browW) {
            if (w < 100) throw new Error('select даты слишком узкий на 320px: ' + JSON.stringify(m.browW));
        }
        /* кнопка не full-width: не шире половины карточки */
        if (m.btn.w > m.vw / 2) throw new Error('кнопка «Сохранить» слишком широкая на 320px: ' + JSON.stringify(m));
    });

    /* топбар с «←» (←, заголовок, пара [ 📅 ][ ⚙ ]) не ломается на 320px:
       карточка техники и карточка тренировки — без переполнения, стрелка кликабельна */
    test('320px: topbar карточки техники и карточки тренировки (← + заголовок + ⚙) без переполнения, стрелка кликабельна', async ({ page, request }) => {
        const today = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            workouts: [doneWorkout(1, today, EX, '100', 3)]
        } } });
        await page.setViewportSize({ width: 320, height: 640 });
        await openApp(page);
        /* карточка упражнения техники: «←» и ⚙ в вьюпорте, друг друга не перекрывают */
        await page.locator('.nav button', { hasText: 'Техника' }).click();
        await page.locator('#techList .excard', { hasText: EX }).first().click();
        await expect(page.locator('.topbar [aria-label="Назад"]')).toHaveCount(1, { timeout: 5000 });
        let m = await page.evaluate(function () {
            const back = document.querySelector('.topbar [aria-label="Назад"]').getBoundingClientRect();
            const gear = document.querySelector('.topbar [aria-label="Настройки"]').getBoundingClientRect();
            return {
                vw: document.documentElement.clientWidth,
                overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
                back: { left: Math.round(back.left), right: Math.round(back.right) },
                gear: { left: Math.round(gear.left), right: Math.round(gear.right) }
            };
        });
        if (m.overflow) throw new Error('переполнение topbar карточки техники на 320px: ' + JSON.stringify(m));
        if (m.back.left < 0 || m.gear.right > m.vw) throw new Error('кнопки topbar за краями 320px: ' + JSON.stringify(m));
        if (m.back.right > m.gear.left) throw new Error('«←» перекрывает ⚙ на 320px: ' + JSON.stringify(m));
        /* тап без force: стрелка реально кликабельна */
        await page.locator('.topbar [aria-label="Назад"]').click();
        await expect(page.locator('#techList')).toBeVisible({ timeout: 5000 });
        /* карточка тренировки: та же геометрия (← + ⚙, 📅 скрыт), нижний backbar на месте */
        await page.locator('.nav button', { hasText: 'История' }).click();
        await page.locator('.pcard').first().click();
        await expect(page.locator('.topbar [aria-label="Назад"]')).toHaveCount(1, { timeout: 5000 });
        await expect(page.locator('.backbar [data-act="closeHistory"]')).toHaveCount(1);
        m = await page.evaluate(function () {
            const back = document.querySelector('.topbar [aria-label="Назад"]').getBoundingClientRect();
            const gear = document.querySelector('.topbar [aria-label="Настройки"]').getBoundingClientRect();
            return {
                vw: document.documentElement.clientWidth,
                overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
                back: { left: Math.round(back.left), right: Math.round(back.right) },
                gear: { left: Math.round(gear.left), right: Math.round(gear.right) }
            };
        });
        if (m.overflow) throw new Error('переполнение topbar карточки тренировки на 320px: ' + JSON.stringify(m));
        if (m.back.left < 0 || m.gear.right > m.vw) throw new Error('кнопки topbar за краями 320px: ' + JSON.stringify(m));
        await page.locator('.topbar [aria-label="Назад"]').click();
        await expect(page.locator('.pcard').first()).toBeVisible({ timeout: 5000 });
    });
});







/* ===== [UX-T27] экран «Настройки» (Story [UX-S4], спека §12) ===== */
test.describe('UX-T27: экран «Настройки»', function () {

    /* §12.1 + §12.2 + §12.10: шестерёнка одна на всех вкладках; состав Настроек;
       с [ONB-T2] в составе есть «Политика конфиденциальности»; «←» возвращает на вкладку-источник */
    test('шестерёнка на всех вкладках: состав Настроек (Оформление/Таймер/Тренер/Политика), «Назад» возвращает на вкладку', async ({ page }) => {
        await openApp(page);
        for (const label of ['История', 'Статистика', 'Техника', 'Профиль']) {
            await page.locator('.nav button', { hasText: label }).click();
            await page.locator('[aria-label="Настройки"]').click();
            await expect(page.locator('.tb-title')).toContainText('Настройки', { timeout: 5000 });
            await expect(page.locator('.card', { hasText: '🎨 Оформление' })).toBeVisible({ timeout: 5000 });
            await expect(page.locator('.card', { hasText: '⏱ Таймер отдыха' })).toBeVisible();
            await expect(page.locator('.card', { hasText: '🧑‍🏫 Персональный тренер' })).toBeVisible();
            /* [ONB-T2] политика реализована: пункт есть в Настройках на любой вкладке */
            await expect(page.locator('#app button', { hasText: 'Политика конфиденциальности' })).toBeVisible({ timeout: 5000 });
            await page.locator('.topbar [aria-label="Назад"]').click();
            await expect(page.locator('.tb-title')).toContainText(label, { timeout: 5000 });
        }
    });

    /* §12.7: «Убрать фон» снимает класс has-bg, ключ gymBg и показывает тост */
    test('фон: «Убрать фон» снимает has-bg с тостом', async ({ page }) => {
        await openApp(page);
        /* ставим фон как loadBg делает на старте (класс + ключ), затем убираем из Настроек */
        await page.evaluate(function () {
            try { localStorage.setItem('gymBg', 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='); } catch (e) { /* noop */ }
            document.documentElement.classList.add('has-bg');
        });
        await page.locator('[aria-label="Настройки"]').click();
        await page.locator('[data-act="clearBg"]').click();
        await expect(page.locator('.toast.show')).toHaveText('Фон убран', { timeout: 5000 });
        const state = await page.evaluate(function () {
            return {
                cls: document.documentElement.classList.contains('has-bg'),
                key: (function () { try { return localStorage.getItem('gymBg'); } catch (e) { return null; } })()
            };
        });
        if (state.cls) throw new Error('класс has-bg не снят');
        if (state.key !== null) throw new Error('ключ gymBg не удалён: ' + state.key);
    });

    /* §12.6 (звук): тогл «Звук по окончании» пишет gymRestSound on/off */
    test('звук таймера: тогл «Звук по окончании» переключает gymRestSound', async ({ page }) => {
        await openApp(page);
        await page.locator('[aria-label="Настройки"]').click();
        const sw = page.locator('[role="switch"][aria-label="Звук по окончании"]');
        /* дефолт: звук включён */
        await expect(sw).toHaveAttribute('aria-checked', 'true', { timeout: 5000 });
        await sw.click();
        await expect(sw).toHaveAttribute('aria-checked', 'false', { timeout: 5000 });
        let v = await page.evaluate(function () { try { return localStorage.getItem('gymRestSound'); } catch (e) { return null; } });
        if (v !== 'off') throw new Error('gymRestSound: ' + v + ', ожидался "off"');
        await page.waitForTimeout(450); /* dedup-окно dispatchFromEl */
        await page.locator('[role="switch"][aria-label="Звук по окончании"]').click();
        await expect(page.locator('[role="switch"][aria-label="Звук по окончании"]')).toHaveAttribute('aria-checked', 'true', { timeout: 5000 });
        v = await page.evaluate(function () { try { return localStorage.getItem('gymRestSound'); } catch (e) { return null; } });
        if (v !== 'on') throw new Error('gymRestSound: ' + v + ', ожидался "on"');
    });

    /* §12.8: Профиль — только данные пользователя; сохранение профиля не сломано */
    test('Профиль переработан: настроек больше нет, карточки данных работают', async ({ page }) => {
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Профиль' }).click();
        const app = page.locator('#app');
        for (const dead of ['Тема оформления', 'Таймер отдыха', 'Фон приложения', 'Полноэкранный режим', 'Персональный тренер']) {
            const cnt = await app.getByText(dead).count();
            if (cnt > 0) throw new Error('в Профиле остался блок «' + dead + '» (экземпляров: ' + cnt + ')');
        }
        /* 4 карточки данных на месте [UX-S4 §7: состав — ровно 4 карточки; дата рождения
            и рост/вес — одна карточка с разделителем, как в макете ux-i8 ред.2] */
        await expect(page.locator('.prof .card')).toHaveCount(4);
        await expect(page.locator('.card', { hasText: '⭐ Любимые упражнения' })).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.sexrow')).toBeVisible();
        await expect(page.locator('#pfBirthYear')).toBeVisible();
        await expect(page.locator('#pfBirthMonth')).toBeVisible();
        /* «⭐ Любимые упражнения» → «Открыть в технике» жива */
        await page.locator('[data-act="openFavs"]').click();
        await expect(page.locator('.tb-title')).toContainText('Техника', { timeout: 5000 });
        await expect(page.locator('.card .secrow .chip', { hasText: '★ Любимые' })).toHaveClass(/on/, { timeout: 5000 });
        /* сохранение перс. данных не сломано [UX-T29]: дата вместо поля «Возраст» */
        await page.locator('.nav button', { hasText: 'Профиль' }).click();
        await page.locator('#pfBirthYear').selectOption('1990');
        await page.locator('#pfBirthMonth').selectOption('11');
        await page.locator('#pfHeight').fill('178');
        await page.locator('#pfWeight').fill('78.5');
        await page.locator('[data-act="saveProfile"]').click();
        await expect(page.locator('.toast.show')).toHaveText('✓ Профиль сохранён', { timeout: 5000 });
    });

    /* имя из Telegram в шапке Профиля: tgWebAppData в URL — vendor сам парсит user в initDataUnsafe
       (свойство только для чтения, патчить WebApp нельзя); тестовый сервер initData не валидирует */
    test('Профиль: имя из Telegram (tgWebAppData) в заголовке карточки', async ({ page }) => {
        const tgData = 'user=' + encodeURIComponent(JSON.stringify({ first_name: 'Артём', last_name: 'Тестов', username: 'artem_t' }));
        await page.goto('/#' + 'tgWebAppData=' + encodeURIComponent(tgData));
        await expect(page.locator('#app .hero, #app .pcard').first()).toBeVisible({ timeout: 10000 });
        await page.locator('.nav button', { hasText: 'Профиль' }).click();
        await expect(page.locator('.card .t1', { hasText: 'Профиль' })).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.prof .card').first()).toContainText('Артём Тестов', { timeout: 5000 });
    });

    /* §12.11: Настройки поверх открытой карточки тренировки: viewWid сохранён, «←» возвращает */
    test('карточка тренировки: шестерёнка доступна, Настройки поверх без backbar, «Назад» возвращает в карточку', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await page.locator('#mWeight').fill('60');
        await page.locator('#mSets').fill('1');
        await page.locator('#mReps').fill('10');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await expect(page.locator('.wcicons').first()).toBeVisible({ timeout: 5000 });
        /* шестерёнка доступна и в карточке тренировки */
        await expect(page.locator('[aria-label="Настройки"]')).toBeVisible();
        await page.locator('[aria-label="Настройки"]').click();
        await expect(page.locator('.tb-title')).toContainText('Настройки', { timeout: 5000 });
        /* backbar карточки на экране Настроек не рендерится */
        await expect(page.locator('.backbar')).toHaveCount(0);
        await page.locator('.topbar [aria-label="Назад"]').click();
        /* карточка восстановлена вместе с записью */
        await expect(page.locator('.wcicons').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.expill .entry').first()).toContainText('60 кг', { timeout: 5000 });
    });

    /* §8.4: нижняя навигация закрывает Настройки поверх карточки, dirty-автосейв [UX-T22] жив */
    test('Настройки поверх карточки с несохранённой правкой: тап по табу автосохраняет и закрывает Настройки', async ({ page, request }) => {
        let failSave = true;
        await page.route('**/api/save', function (route) {
            if (failSave) route.abort();
            else route.fallback();
        });
        await openApp(page);
        await startAndPick(page, EX);
        /* прямое сохранение падает (failSave): запись только локально, состояние dirty */
        await page.locator('#mWeight').fill('60');
        await page.locator('#mSets').fill('1');
        await page.locator('#mReps').fill('10');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        /* шестерёнка поверх карточки: Настройки открылись, backbar скрыт */
        await page.locator('[aria-label="Настройки"]').click();
        await expect(page.locator('.tb-title')).toContainText('Настройки', { timeout: 5000 });
        await expect(page.locator('.backbar')).toHaveCount(0);
        /* сеть восстановилась: тап по табу нижней навигации закрывает Настройки
           и запускает dirty-автосейв карточки [UX-S4 §8.4] */
        failSave = false;
        await page.locator('.nav button', { hasText: 'Статистика' }).click();
        await expect(page.locator('.tb-title')).toContainText('Статистика', { timeout: 5000 });
        await expect.poll(async function () {
            const st = await (await request.get('/api/state')).json();
            const act = (st.workouts || []).filter(function (w) { return !w.finished; })[0];
            return act && act.exercises && act.exercises[0] && act.exercises[0].sets.length ? 'saved' : 'pending';
        }, { timeout: 5000 }).toBe('saved');
    });

    /* чек-лист §8.5/§10: узкие экраны — строки с тоглами и чипы без переполнения */
    test('320px: Настройки без горизонтального переполнения, тогл прижат вправо строки', async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 640 });
        await openApp(page);
        await page.locator('[aria-label="Настройки"]').click();
        await expect(page.locator('.card', { hasText: '🎨 Оформление' })).toBeVisible({ timeout: 5000 });
        const m = await page.evaluate(function () {
            return {
                overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
                swRight: document.querySelector('.switch').getBoundingClientRect().right,
                rowRight: document.querySelector('.setrow').getBoundingClientRect().right
            };
        });
        if (m.overflow) throw new Error('горизонтальное переполнение Настроек на 320px');
        if (m.rowRight - m.swRight > 2) throw new Error('тогл не прижат к правому краю строки: ' + (m.rowRight - m.swRight).toFixed(1) + 'px');
    });
});

/* ===== [UX-T29] дата рождения: select год+месяц вместо поля «Возраст» (спека §11) ===== */
/* склонение возраста — та же логика, что ageWord в app.js */
function ageWordOf(n) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'год';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'года';
    return 'лет';
}

test.describe('UX-T29: дата рождения в Профиле', function () {

    /* §11.1: новый профиль — сохранение без даты отклонено; с датой — сохраняется,
       саммари показывает вычисленный возраст со склонением */
    test('новый профиль: без даты тост-ошибка и профиль не записан; с датой — ✓ и возраст в саммари', async ({ page, request }) => {
        await request.post('/api/reset?noprofile=1'); /* сценарий новичка (дефолтный store — legacy age-only) */
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Профиль' }).click();
        await expect(page.locator('#pfBirthYear')).toBeVisible({ timeout: 5000 });
        await page.locator('#pfHeight').fill('180');
        await page.locator('#pfWeight').fill('80');
        await page.locator('[data-act="saveProfile"]').click();
        await expect(page.locator('.toast.show')).toHaveText('Укажи год и месяц рождения — они нужны для расчёта калорий', { timeout: 5000 });
        const st0 = await (await request.get('/api/state')).json();
        if (st0.profile) throw new Error('профиль записался без даты: ' + JSON.stringify(st0.profile));
        const now = new Date();
        await page.locator('#pfBirthYear').selectOption('1990');
        await page.locator('#pfBirthMonth').selectOption(String(now.getMonth() + 1));
        await page.locator('[data-act="saveProfile"]').click();
        await expect(page.locator('.toast.show')).toHaveText('✓ Профиль сохранён', { timeout: 5000 });
        const st = await (await request.get('/api/state')).json();
        if (!st.profile || st.profile.birthYear !== 1990 || st.profile.birthMonth !== now.getMonth() + 1) {
            throw new Error('birth-пара не сохранилась: ' + JSON.stringify(st.profile));
        }
        /* месяц = текущий → возраст ровно 36, склонение «лет» */
        await expect(page.locator('.prof .card .meta').first()).toContainText('М · 36 лет · 180 см · 80 кг');
    });

    /* §11.2: списки select — годы по убыванию (первая опция «—», верх = текущий−5, низ = 1930),
       месяц — ровно 13 опций: «Выбрать…» + Январь…Декабрь */
    test('списки select: годы текущий−5…1930 по убыванию, месяцы «Выбрать…»+Январь…Декабрь', async ({ page }) => {
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Профиль' }).click();
        const opts = await page.evaluate(function () {
            const y = document.querySelector('#pfBirthYear');
            const m = document.querySelector('#pfBirthMonth');
            return {
                years: Array.prototype.map.call(y.options, function (o) { return o.value; }),
                months: Array.prototype.map.call(m.options, function (o) { return o.textContent; })
            };
        });
        const now = new Date();
        const top = String(now.getFullYear() - 5);
        const low = String(Math.max(1930, now.getFullYear() - 100));
        if (opts.years[0] !== '' || opts.years[1] !== top) {
            throw new Error('начало списка годов не «—»/текущий−5: ' + opts.years.slice(0, 2).join(','));
        }
        if (opts.years[opts.years.length - 1] !== low) {
            throw new Error('последняя опция года не ' + low + ': ' + opts.years[opts.years.length - 1]);
        }
        for (let i = 2; i < opts.years.length; i++) {
            if (+opts.years[i] !== +opts.years[i - 1] - 1) {
                throw new Error('годы не по убыванию: ' + opts.years.slice(i - 1, i + 1).join(','));
            }
        }
        if (opts.months.length !== 13 || opts.months[0] !== 'Выбрать…') {
            throw new Error('опции месяца: ' + opts.months.join(','));
        }
        if (opts.months[1] !== 'Январь' || opts.months[12] !== 'Декабрь') {
            throw new Error('имена месяцев: ' + opts.months.join(','));
        }
    });

    /* §11.3: живой возраст — строка скрыта при неполной паре, появляется до сохранения,
       смена года обновляет строку сразу */
    test('живой возраст: неполная пара — строка скрыта; пара выбрана — «Возраст: N слово» до сохранения', async ({ page }) => {
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Профиль' }).click();
        const line = page.locator('#pfBirthAge');
        await expect(line).toBeHidden({ timeout: 5000 });
        await page.locator('#pfBirthYear').selectOption('1990');
        await expect(line).toBeHidden(); /* месяц ещё «Выбрать…» */
        const now = new Date();
        const exp = now.getFullYear() - 1990 - ((now.getMonth() + 1) < 11 ? 1 : 0);
        await page.locator('#pfBirthMonth').selectOption('11');
        await expect(line).toBeVisible();
        await expect(line).toHaveText('Возраст: ' + exp + ' ' + ageWordOf(exp));
        /* смена года обновляет строку сразу (1985 — на 5 лет раньше 1990-го) */
        await page.locator('#pfBirthYear').selectOption('1985');
        await expect(line).toHaveText('Возраст: ' + (exp + 5) + ' ' + ageWordOf(exp + 5));
    });

    /* §11.4: частичный ввод — тост + .err на обоих select; сброс обоих на «—» —
       легитимное legacy-сохранение (age прежний, birth-ключей нет) */
    test('частичный ввод: тост «Укажи и год, и месяц…», .err; сброс на «—» — legacy-сохранение', async ({ page, request }) => {
        const today = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            profile: { sex: 'м', age: 31, height: 190, weight: 95 },
            workouts: [doneWorkout(1, today, EX, '100', 3)]
        } } });
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Профиль' }).click();
        await page.locator('#pfBirthYear').selectOption('1985');
        await page.locator('[data-act="saveProfile"]').click();
        await expect(page.locator('.toast.show')).toHaveText('Укажи и год, и месяц — или выбери „—“ в обоих полях', { timeout: 5000 });
        await expect(page.locator('#pfBirthYear')).toHaveClass(/err/);
        await expect(page.locator('#pfBirthMonth')).toHaveClass(/err/);
        /* сброс года на «—» → сохранение в legacy-режиме проходит */
        await page.locator('#pfBirthYear').selectOption('');
        await page.locator('#pfWeight').fill('93');
        await page.locator('[data-act="saveProfile"]').click();
        await expect(page.locator('.toast.show')).toHaveText('✓ Профиль сохранён', { timeout: 5000 });
        const st = await (await request.get('/api/state')).json();
        if (!st.profile || st.profile.age !== 31 || st.profile.weight !== 93
            || st.profile.birthYear !== undefined || st.profile.birthMonth !== undefined) {
            throw new Error('legacy-сохранение сломано: ' + JSON.stringify(st.profile));
        }
    });

    /* [UX-T29] §4.5 п.3: валидация рост/вес — вес 500 отклоняется тостом, профиль не записан */
    test('рост/вес: вес 500 — тост «Проверь значения…», профиль на сервере не изменён', async ({ page, request }) => {
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Профиль' }).click();
        await expect(page.locator('#pfBirthYear')).toBeVisible({ timeout: 5000 });
        /* дата валидна — ошибка именно по росту/весу (порядок проверок §4.5: дата → рост/вес) */
        const now = new Date();
        await page.locator('#pfBirthYear').selectOption('1990');
        await page.locator('#pfBirthMonth').selectOption(String(now.getMonth() + 1));
        await page.locator('#pfHeight').fill('180');
        await page.locator('#pfWeight').fill('500');
        await page.locator('[data-act="saveProfile"]').click();
        await expect(page.locator('.toast.show')).toHaveText('Проверь значения: рост 100–250, вес 30–300', { timeout: 5000 });
        /* профиль на сервере не записан: остался дефолтный legacy (age 30, weight 90), birth-ключей нет */
        const st = await (await request.get('/api/state')).json();
        if (!st.profile || st.profile.weight !== 90 || st.profile.age !== 30
            || st.profile.birthYear !== undefined || st.profile.birthMonth !== undefined) {
            throw new Error('профиль записался с невалидным весом: ' + JSON.stringify(st.profile));
        }
    });

    /* §11.5: границы возраста [I8-update 09.11: минимум 5 лет вместо 10] —
       год текущий−5 (5 лет) и 1930 сохраняются без ошибок */
    test('границы возраста: год текущий−5 → ровно 5 лет; год 1930 сохраняется', async ({ page, request }) => {
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Профиль' }).click();
        const now = new Date();
        await page.locator('#pfBirthYear').selectOption(String(now.getFullYear() - 5));
        await page.locator('#pfBirthMonth').selectOption(String(now.getMonth() + 1));
        await page.locator('#pfHeight').fill('178');
        await page.locator('#pfWeight').fill('78.5');
        await page.locator('[data-act="saveProfile"]').click();
        await expect(page.locator('.toast.show')).toHaveText('✓ Профиль сохранён', { timeout: 5000 });
        let st = await (await request.get('/api/state')).json();
        if (!st.profile || st.profile.age !== 5) throw new Error('возраст 5 не сохранился: ' + JSON.stringify(st.profile));
        /* 1930 — последняя опция списка */
        await page.locator('#pfBirthYear').selectOption('1930');
        await page.locator('[data-act="saveProfile"]').click();
        await expect(page.locator('.toast.show')).toHaveText('✓ Профиль сохранён', { timeout: 5000 });
        st = await (await request.get('/api/state')).json();
        if (!st.profile || st.profile.birthYear !== 1930 || st.profile.age !== now.getFullYear() - 1930) {
            throw new Error('год 1930 не сохранился: ' + JSON.stringify(st.profile));
        }
    });

    /* §11.6: legacy age-only — саммари с прежним возрастом, плашка-подсказка; обновление
       веса не трогает дату/age; после указания даты возраст пересчитался */
    test('legacy age-only: плашка миграции, сохранение веса без даты, затем пересчёт от даты', async ({ page, request }) => {
        const today = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            profile: { sex: 'м', age: 31, height: 190, weight: 95 },
            workouts: [doneWorkout(1, today, EX, '100', 3)]
        } } });
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Профиль' }).click();
        /* саммари с прежним возрастом и склонением (31 год) */
        await expect(page.locator('.prof .card .meta').first()).toContainText('М · 31 год · 190 см · 95 кг', { timeout: 5000 });
        /* плашка-подсказка видна, оба select в плейсхолдерном состоянии */
        await expect(page.locator('.prof .hint')).toContainText('Укажи год и месяц рождения — возраст станет обновляться сам');
        await expect(page.locator('#pfBirthYear')).toHaveClass(/ph/);
        await expect(page.locator('#pfBirthMonth')).toHaveClass(/ph/);
        /* обновление веса без даты разрешено: age не изменился, birth-ключей нет */
        await page.locator('#pfWeight').fill('94');
        await page.locator('[data-act="saveProfile"]').click();
        await expect(page.locator('.toast.show')).toHaveText('✓ Профиль сохранён', { timeout: 5000 });
        let st = await (await request.get('/api/state')).json();
        if (!st.profile || st.profile.age !== 31 || st.profile.weight !== 94
            || st.profile.birthYear !== undefined || st.profile.birthMonth !== undefined) {
            throw new Error('legacy-сохранение: ' + JSON.stringify(st.profile));
        }
        /* указание даты — возраст пересчитался (месяц = текущий → ровно 36) */
        const now = new Date();
        await page.locator('#pfBirthYear').selectOption('1990');
        await page.locator('#pfBirthMonth').selectOption(String(now.getMonth() + 1));
        await page.locator('[data-act="saveProfile"]').click();
        await expect(page.locator('.toast.show')).toHaveText('✓ Профиль сохранён', { timeout: 5000 });
        st = await (await request.get('/api/state')).json();
        if (!st.profile || st.profile.age !== 36 || st.profile.birthYear !== 1990) {
            throw new Error('дата не применилась: ' + JSON.stringify(st.profile));
        }
        /* плашка пропала после заполнения */
        await expect(page.locator('.prof .hint')).toHaveCount(0);
    });

    /* §11.7: BMR живой — смена года на 5 лет меняет BMR саммари на ~25 ккал (5 × 5) */
    test('BMR живой: год на 5 лет раньше → BMR саммари меньше на 25 ккал', async ({ page, request }) => {
        const today = isoDate(new Date());
        const now = new Date();
        const by = 1990;
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            profile: { sex: 'м', age: 36, height: 178, weight: 78.5, birthYear: by, birthMonth: now.getMonth() + 1 },
            workouts: [doneWorkout(1, today, EX, '100', 3)]
        } } });
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Профиль' }).click();
        /* месяц рождения = текущий → вычисленный возраст = год-разница ровно */
        const bmrOf = function (age) { return Math.round(10 * 78.5 + 6.25 * 178 - 5 * age + 5); };
        const age0 = now.getFullYear() - by;
        await expect(page.locator('.prof .card', { hasText: 'BMR' })).toContainText('BMR ≈ ' + bmrOf(age0) + ' ккал/сут', { timeout: 5000 });
        await page.locator('#pfBirthYear').selectOption(String(by - 5));
        await page.locator('[data-act="saveProfile"]').click();
        await expect(page.locator('.toast.show')).toHaveText('✓ Профиль сохранён', { timeout: 5000 });
        await expect(page.locator('.prof .card', { hasText: 'BMR' })).toContainText('BMR ≈ ' + bmrOf(age0 + 5) + ' ккал/сут', { timeout: 5000 });
    });

    /* §11.8: бейдж «🎂 Твой день рождения в этом месяце» — только в месяце рождения */
    test('бейдж дня рождения: виден в месяце рождения, пропадает вне месяца', async ({ page, request }) => {
        const now = new Date();
        const curMonth = now.getMonth() + 1;
        const otherMonth = curMonth === 12 ? 1 : curMonth + 1;
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            profile: { sex: 'м', age: 36, height: 178, weight: 78.5, birthYear: 1990, birthMonth: curMonth },
            workouts: []
        } } });
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Профиль' }).click();
        await expect(page.locator('.prof .bdg')).toHaveText('🎂 Твой день рождения в этом месяце', { timeout: 5000 });
        /* смена месяца рождения — бейджа больше нет */
        await page.locator('#pfBirthMonth').selectOption(String(otherMonth));
        await page.locator('[data-act="saveProfile"]').click();
        await expect(page.locator('.toast.show')).toHaveText('✓ Профиль сохранён', { timeout: 5000 });
        await expect(page.locator('.prof .bdg')).toHaveCount(0);
    });

    /* §11.9: серверные данные — birthYear/birthMonth и age-зеркало = вычисленному */
    test('/api/state после сохранения: birthYear/birthMonth и age-зеркало = вычисленному', async ({ page, request }) => {
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Профиль' }).click();
        const now = new Date();
        await page.locator('#pfBirthYear').selectOption('1990');
        await page.locator('#pfBirthMonth').selectOption(String(now.getMonth() + 1));
        await page.locator('#pfHeight').fill('178');
        await page.locator('#pfWeight').fill('78.5');
        await page.locator('[data-act="saveProfile"]').click();
        await expect(page.locator('.toast.show')).toHaveText('✓ Профиль сохранён', { timeout: 5000 });
        const st = await (await request.get('/api/state')).json();
        const exp = now.getFullYear() - 1990; /* месяц = текущий → ровно */
        if (!st.profile || st.profile.birthYear !== 1990 || st.profile.birthMonth !== now.getMonth() + 1
            || st.profile.age !== exp) {
            throw new Error('серверные данные: ' + JSON.stringify(st.profile));
        }
    });
    /* §11.10 (регресс 320px: два select в ряд + prow без переполнения) —
       покрыт тестом «[UX-T29] 320px: дата рождения и ряд профиля…» выше */
});

/* ============ [UX-S6] календарь тренировок (20 кейсов §14 спеки, ред. 7.3) ============ */
const CAL_MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const CAL_MONTHS_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
const CAL_MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

test.describe('UX-S6 календарь', function () {

    /* сид: массив тренировок одним POST /api/save (как в тестах выше) */
    async function seedWorkouts(request, workouts) {
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: workouts.reduce(function (mx, w) { return Math.max(mx, w.id + 1); }, 1),
            del: [], workouts: workouts } } });
    }
    async function openCalendar(page) {
        /* [UX-I17] дефолтный вид — «Неделя» (§12.2, gymCalView отсутствует → week).
           Сценарии S6 ниже проверяют месячный вид — фиксируем его явно; пикер,
           Неделя и дефолт покрываются отдельными сценариями [UX-S10 T4] */
        await page.evaluate(function () { localStorage.setItem('gymCalView', 'month'); });
        await page.locator('.topbar [data-act="openCal"]').click();
        await expect(page.locator('.cal-grid')).toBeVisible({ timeout: 5000 });
    }
    /* сдвиг месяца от текущего: n = -1 прошлый, +1 будущий (переход года учтён Date'ом) */
    function monthShift(n) {
        const d = new Date();
        return { y: d.getFullYear() + (d.getMonth() + n < 0 ? -1 : (d.getMonth() + n > 11 ? 1 : 0)),
            m: ((d.getMonth() + n) % 12 + 12) % 12 };
    }
    function isoOf(ym, day) {
        return ym.y + '-' + String(ym.m + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    }
    /* тренировка с явным временем (для сортировки панели дня) */
    function workoutAt(id, day, start, end, name, finished) {
        return { id: id, date: day, started: day + 'T' + start, ended: day + 'T' + end, finished: finished !== false,
            title: '', nutrition: '',
            exercises: [{ name: name, st: day + 'T' + start, en: day + 'T' + end,
                sets: [{ w: '60', s: 3, r: '8-10', t: day + 'T' + start }] }] };
    }

    test('§14.1 точка входа: кнопка на ВСЕХ пяти вкладках перед шестерёнкой; «Назад» возвращает на вкладку-источник', async ({ page }) => {
        await openApp(page);
        const calBtn = page.locator('.topbar [data-act="openCal"]');
        await expect(calBtn).toHaveCount(1);
        /* порядок: календарь СЛЕВА, шестерёнка справа [§3.2] */
        const btns = page.locator('.topbar .tb-user');
        await expect(btns.nth(0)).toHaveAttribute('aria-label', 'Календарь');
        await expect(btns.nth(1)).toHaveAttribute('aria-label', 'Настройки');
        /* кнопка есть на КАЖДОЙ из пяти вкладок [S6-update4 — «как и настройки»] */
        for (const t of ['Статистика', 'Техника', 'Профиль']) {
            await page.locator('.nav button', { hasText: t }).click();
            await expect(page.locator('.topbar .tb-title')).toHaveText(t);
            await expect(page.locator('.topbar [data-act="openCal"]')).toHaveCount(1);
        }
        /* «Тренер» — через Настройки («Открыть раздел») */
        await page.locator('.topbar [data-act="openSettings"]').click();
        await page.locator('[data-act="switchTab"][data-a="coach"]').click();
        await expect(page.locator('.topbar .tb-title')).toHaveText('Тренер');
        await expect(page.locator('.topbar [data-act="openCal"]')).toHaveCount(1);
        /* тап с Профиля: заголовок, «Назад», шестерёнка в topbar, календарь отрисован [S6-update5]
           [UX-I17] дефолтный вид — «Неделя» (§12.2): маркер открытого календаря — полоса дней */
        await page.locator('.nav button', { hasText: 'Профиль' }).click();
        await calBtn.click();
        await expect(page.locator('.tb-title')).toHaveText('Календарь');
        await expect(page.locator('.topbar [data-act="closeCal"]')).toHaveCount(1);
        await expect(page.locator('.topbar [data-act="openSettings"]')).toHaveCount(1);
        await expect(page.locator('.wk-days')).toBeVisible();
        /* «Назад» — возврат на вкладку-источник (calFromTab) [§3.4] */
        await page.locator('.topbar [data-act="closeCal"]').click();
        await expect(page.locator('.topbar .tb-title')).toHaveText('Профиль');
        /* с Истории — как в 1.28 */
        await page.locator('.nav button', { hasText: 'История' }).click();
        await openCalendar(page);
        await page.locator('.topbar [data-act="closeCal"]').click();
        await expect(page.locator('.topbar .tb-title')).toHaveText('История');
    });

    test('§14.2 кнопка скрыта: при открытой карточке и на Настройках; на календаре 📅 нет, но шестерёнка ЕСТЬ', async ({ page, request }) => {
        const today = isoDate(new Date());
        await seedWorkouts(request, [workoutAt(1, today, '09:30:00', '10:30:00', EX)]);
        await openApp(page);
        await page.locator('.pcard').first().click();
        await expect(page.locator('.wcicons').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.topbar [data-act="openCal"]')).toHaveCount(0);
        await page.locator('.bb-back').click();
        await page.locator('.topbar [data-act="openSettings"]').click();
        await expect(page.locator('.tb-title')).toHaveText('Настройки');
        /* на Настройках шестерёнки нет — своя шапка [§3.2, §14.2] */
        await expect(page.locator('.topbar [data-act="openSettings"]')).toHaveCount(0);
        await expect(page.locator('.topbar [data-act="openCal"]')).toHaveCount(0);
        await page.locator('.topbar [data-act="closeSettings"]').click();
        /* на экране календаря кнопки 📅 нет — он уже открыт; шестерёнка открывает Настройки [S6-update5] */
        await openCalendar(page);
        await expect(page.locator('.topbar [data-act="openCal"]')).toHaveCount(0);
        const gear = page.locator('.topbar [data-act="openSettings"]');
        await expect(gear).toHaveCount(1);
        await expect(gear).toHaveAttribute('aria-label', 'Настройки');
        await gear.click();
        await expect(page.locator('.tb-title')).toHaveText('Настройки');
        await expect(page.locator('.cal-grid')).toHaveCount(0);
    });

    test('§14.2б (доп.) ⚙ с календаря: Настройки поверх календаря; «← Назад» возвращает в календарь, таб закрывает оба', async ({ page, request }) => {
        const today = isoDate(new Date());
        await seedWorkouts(request, [workoutAt(1, today, '09:30:00', '10:30:00', EX)]);
        await openApp(page);
        await openCalendar(page);
        await page.locator('[data-act="calPrev"]').click();
        const prevYm = monthShift(-1);
        await expect(page.locator('.cal-title')).toHaveText(CAL_MONTHS[prevYm.m] + ' ' + prevYm.y);
        /* ⚙ на экране календаря → Настройки [S6-update5, §3.4] */
        await page.locator('.topbar [data-act="openSettings"]').click();
        await expect(page.locator('.tb-title')).toHaveText('Настройки');
        /* «← Назад» с Настроек — возврат В КАЛЕНДАРЬ (calOpen сохраняется), месяц тот же [§3.4] */
        await page.locator('.topbar [data-act="closeSettings"]').click();
        await expect(page.locator('.tb-title')).toHaveText('Календарь');
        await expect(page.locator('.cal-grid')).toBeVisible();
        await expect(page.locator('.cal-title')).toHaveText(CAL_MONTHS[prevYm.m] + ' ' + prevYm.y);
        /* снова ⚙, затем тап нижнего таба: switchTab закрывает и Настройки, и календарь [§3.4] */
        await page.locator('.topbar [data-act="openSettings"]').click();
        await expect(page.locator('.tb-title')).toHaveText('Настройки');
        await page.locator('.nav button', { hasText: 'История' }).click();
        await expect(page.locator('.tb-title')).toHaveText('История');
        await expect(page.locator('.cal-grid')).toHaveCount(0);
        /* повторное открытие с таба-источника — месяц восстановился из gymCalMonth [§7.3] */
        await openCalendar(page);
        await expect(page.locator('.cal-title')).toHaveText(CAL_MONTHS[prevYm.m] + ' ' + prevYm.y);
    });

    test('§14.3 отметки: точки по числу тренировок (1 и 2), завершённые — заливка', async ({ page, request }) => {
        const now = new Date();
        const dayA = isoOf({ y: now.getFullYear(), m: now.getMonth() }, 5);
        const dayB = isoOf({ y: now.getFullYear(), m: now.getMonth() }, 8);
        await seedWorkouts(request, [
            workoutAt(1, dayA, '09:30:00', '10:30:00', EX),
            workoutAt(2, dayB, '08:40:00', '09:30:00', 'Грудь + спина'),
            workoutAt(3, dayB, '18:10:00', '19:05:00', 'Жим · трицепс')
        ]);
        await openApp(page);
        await openCalendar(page);
        const cellA = page.locator('.cal-d[data-a="' + dayA + '"]');
        const cellB = page.locator('.cal-d[data-a="' + dayB + '"]');
        await expect(cellA.locator('.dot')).toHaveCount(1);
        await expect(cellB.locator('.dot')).toHaveCount(2);
        await expect(page.locator('.dot.hollow')).toHaveCount(0);
        await expect(cellB).toHaveAttribute('aria-label', '8 ' + CAL_MONTHS_GEN[now.getMonth()] + ', 2 тренировки');
    });

    test('§14.4 тап дня с 1 тренировкой → панель (.drow.multi, запятая-список ≤4), НЕ карточка; тап строки → карточка', async ({ page, request }) => {
        const now = new Date();
        const dayB = isoOf({ y: now.getFullYear(), m: now.getMonth() }, 6);
        const mk = workoutAt(1, dayB, '08:40:00', '09:30:00', 'Приседания');
        /* 5 упражнений: в .nm попадут первые 4 через запятую, «и ещё N» нет [S6-update6b] */
        mk.exercises = ['Приседания', 'Жим ногами', 'Разгибания', 'Икры стоя', 'Сгибания'].map(function (n, i) {
            return { name: n, st: dayB + 'T08:4' + i + ':00', en: dayB + 'T09:00:00',
                sets: [{ w: '60', s: 3, r: '8-10', t: dayB + 'T08:4' + i + ':00' }] };
        });
        await seedWorkouts(request, [mk]);
        await openApp(page);
        await openCalendar(page);
        await page.locator('.cal-d[data-a="' + dayB + '"]').click();
        /* карточка НЕ открыта — панель всегда первая [S6-update4] */
        await expect(page.locator('.backbar')).toHaveCount(0);
        await expect(page.locator('.wcicons')).toHaveCount(0);
        const panel = page.locator('.daypanel');
        await expect(panel).toBeVisible({ timeout: 5000 });
        await expect(panel.locator('.dph .cnt')).toHaveText('1 тренировка');
        const row = panel.locator('.drow');
        await expect(row).toHaveCount(1);
        await expect(row).toHaveClass(/multi/);
        /* .nm — запятая-список первых 4 упражнений; .tm время; .st подходы */
        await expect(row.locator('.nm')).toHaveText('Приседания, Жим ногами, Разгибания, Икры стоя');
        await expect(row.locator('.tm')).toContainText('08:40');
        await expect(row.locator('.st')).toHaveText(/🏋/);
        /* clamp-2 в CSS: перенос ограничен двумя строками [§6.1] */
        const clamp = await row.locator('.nm').evaluate(function (el) { return getComputedStyle(el).webkitLineClamp; });
        expect(clamp).toBe('2');
        /* тап по строке → карточка этой тренировки (id совпадает) */
        await row.click();
        await expect(page.locator('#w1')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.backbar')).toBeVisible();
        /* «Назад» backbar'а → календарь: месяц и выбранный день сохранены [§6, §14.4] */
        await page.locator('.bb-back').click();
        await expect(page.locator('.cal-grid')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.cal-title')).toHaveText(CAL_MONTHS[now.getMonth()] + ' ' + now.getFullYear());
        await expect(page.locator('.daypanel')).toBeVisible();
        await expect(page.locator('.cal-d.sel')).toHaveAttribute('data-a', dayB);
    });

    test('§14.4б (доп.) 1 тренировка без подходящих упражнений: .nm = «Без упражнений», тап строки всё равно открывает', async ({ page, request }) => {
        const now = new Date();
        const dayB = isoOf({ y: now.getFullYear(), m: now.getMonth() }, 6);
        const w = workoutAt(1, dayB, '08:40:00', '09:30:00', 'Разминка');
        w.exercises = [{ name: 'Разминка', st: dayB + 'T08:41:00', en: dayB + 'T09:00:00', sets: [] }];
        await seedWorkouts(request, [w]);
        await openApp(page);
        await openCalendar(page);
        await page.locator('.cal-d[data-a="' + dayB + '"]').click();
        const row = page.locator('.daypanel .drow');
        await expect(row).toHaveCount(1);
        await expect(row).toHaveClass(/multi/);
        await expect(row.locator('.nm')).toHaveText('Без упражнений');
        await row.click();
        await expect(page.locator('#w1')).toBeVisible({ timeout: 5000 });
    });

    test('§14.5 тап дня с 2 тренировками → панель (карточка НЕ открыта), тап строки → карточка по id', async ({ page, request }) => {
        const now = new Date();
        const dayB = isoOf({ y: now.getFullYear(), m: now.getMonth() }, 8);
        await seedWorkouts(request, [
            workoutAt(1, dayB, '08:40:00', '09:30:00', 'Грудь + спина'),
            workoutAt(2, dayB, '18:10:00', '19:05:00', 'Жим · трицепс')
        ]);
        await openApp(page);
        await openCalendar(page);
        await page.locator('.cal-d[data-a="' + dayB + '"]').click();
        const panel = page.locator('.daypanel');
        await expect(panel).toBeVisible({ timeout: 5000 });
        /* карточка НЕ открыта — панель едина для любого числа тренировок [S6-update4/6] */
        await expect(page.locator('.backbar')).toHaveCount(0);
        await expect(panel.locator('.dph .cnt')).toHaveText('2 тренировки');
        await expect(panel.locator('.drow')).toHaveCount(2);
        /* при 2+ — названия по firstLine, БЕЗ .multi и запятая-списка [S6-update6b] */
        await expect(panel.locator('.drow.multi')).toHaveCount(0);
        await expect(panel.locator('.drow .nm').first()).toHaveText('Грудь + спина');
        await expect(panel.locator('.drow .nm').nth(1)).toHaveText('Жим · трицепс');
        /* строки по возрастанию времени: 08:40 первая */
        await expect(panel.locator('.drow .tm').first()).toContainText('08:40');
        await expect(panel.locator('.drow .tm').nth(1)).toContainText('18:10');
        await panel.locator('.drow').first().click();
        await expect(page.locator('#w1')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.backbar')).toBeVisible();
        /* возврат в календарь: выбор дня сохранён, панель снова видна */
        await page.locator('.bb-back').click();
        await expect(page.locator('.daypanel')).toBeVisible({ timeout: 5000 });
    });

    test('§14.6 переключение/сброс панели: тап другого дня заменяет содержимое, повторный — скрывает, пустой день не меняет', async ({ page, request }) => {
        const now = new Date();
        const dayA = isoOf({ y: now.getFullYear(), m: now.getMonth() }, 5);
        const dayB = isoOf({ y: now.getFullYear(), m: now.getMonth() }, 8);
        const dayC = isoOf({ y: now.getFullYear(), m: now.getMonth() }, 12); /* без тренировок */
        await seedWorkouts(request, [
            workoutAt(1, dayA, '09:30:00', '10:30:00', 'Ноги'),
            workoutAt(2, dayB, '08:40:00', '09:30:00', 'Грудь + спина'),
            workoutAt(3, dayB, '18:10:00', '19:05:00', 'Жим · трицепс')
        ]);
        await openApp(page);
        await openCalendar(page);
        await page.locator('.cal-d[data-a="' + dayA + '"]').click();
        const panel = page.locator('.daypanel');
        await expect(panel).toBeVisible({ timeout: 5000 });
        await expect(panel.locator('.dph .cnt')).toHaveText('1 тренировка');
        /* тап по дню Б — панель заменилась содержимым на месте [§6] */
        await page.locator('.cal-d[data-a="' + dayB + '"]').click();
        await expect(panel.locator('.dph .cnt')).toHaveText('2 тренировки');
        await expect(panel.locator('.drow')).toHaveCount(2);
        await expect(page.locator('.cal-d.sel')).toHaveAttribute('data-a', dayB);
        /* повторный тап по Б — панель скрыта (sel = null) */
        await page.locator('.cal-d[data-a="' + dayB + '"]').click();
        await expect(panel).toHaveCount(0);
        /* тап по дню без тренировок — панель не появляется [§6] */
        await page.locator('.cal-d[data-a="' + dayC + '"]').click();
        await expect(panel).toHaveCount(0);
        await expect(page.locator('.cal-d.sel')).toHaveCount(0);
    });

    test('§14.7 навигация: ‹/› работают, «Сегодня» только на не-текущем месяце', async ({ page, request }) => {
        const now = new Date();
        const today = isoDate(now);
        await seedWorkouts(request, [workoutAt(1, today, '09:30:00', '10:30:00', EX)]);
        await openApp(page);
        await openCalendar(page);
        /* на текущем месяце пилюли нет [S6-update2] */
        await expect(page.locator('.cal-today')).toHaveCount(0);
        /* › активна и на текущем месяце — будущие месяцы показываем [S6-update3] */
        await expect(page.locator('[data-act="calNext"]')).toBeEnabled();
        await page.locator('[data-act="calPrev"]').click();
        const prevYm = monthShift(-1);
        await expect(page.locator('.cal-title')).toHaveText(CAL_MONTHS[prevYm.m] + ' ' + prevYm.y);
        await expect(page.locator('.cal-today')).toBeVisible();
        await page.locator('.cal-today').click();
        await expect(page.locator('.cal-title')).toHaveText(CAL_MONTHS[now.getMonth()] + ' ' + now.getFullYear());
        await expect(page.locator('.cal-today')).toHaveCount(0);
        /* вперёд в будущий месяц — «Сегодня» тоже видна [S6-update3] */
        await page.locator('[data-act="calNext"]').click();
        const nextYm = monthShift(1);
        await expect(page.locator('.cal-title')).toHaveText(CAL_MONTHS[nextYm.m] + ' ' + nextYm.y);
        await expect(page.locator('.cal-today')).toBeVisible();
    });

    test('§14.8 предел назад = январь 2020: ‹ disabled', async ({ page, request }) => {
        const today = isoDate(new Date());
        await seedWorkouts(request, [workoutAt(1, today, '09:30:00', '10:30:00', EX)]);
        await openApp(page);
        await page.evaluate(function () { localStorage.setItem('gymCalMonth', '2020-01'); });
        await openCalendar(page);
        await expect(page.locator('.cal-title')).toHaveText('Январь 2020');
        const prevBtn = page.locator('[data-act="calPrev"]');
        await expect(prevBtn).toBeDisabled();
        await expect(prevBtn).toHaveAttribute('aria-disabled', 'true');
    });

    test('§14.9 память месяца: закрыл/открыл — месяц тот же (gymCalMonth)', async ({ page, request }) => {
        const now = new Date();
        const today = isoDate(now);
        await seedWorkouts(request, [workoutAt(1, today, '09:30:00', '10:30:00', EX)]);
        await openApp(page);
        await openCalendar(page);
        await page.locator('[data-act="calPrev"]').click();
        const prevYm = monthShift(-1);
        await expect(page.locator('.cal-title')).toHaveText(CAL_MONTHS[prevYm.m] + ' ' + prevYm.y);
        await page.locator('.topbar [data-act="closeCal"]').click();
        await expect(page.locator('.pcard').first()).toBeVisible();
        await openCalendar(page);
        await expect(page.locator('.cal-title')).toHaveText(CAL_MONTHS[prevYm.m] + ' ' + prevYm.y);
        await page.locator('.cal-today').click();
        await expect(page.locator('.cal-title')).toHaveText(CAL_MONTHS[now.getMonth()] + ' ' + now.getFullYear());
    });

    test('§14.10 битый gymCalMonth: без ошибки, дефолтный месяц (месяц последней тренировки)', async ({ page, request }) => {
        const now = new Date();
        const today = isoDate(now);
        await seedWorkouts(request, [workoutAt(1, today, '09:30:00', '10:30:00', EX)]);
        await openApp(page);
        await page.evaluate(function () { localStorage.setItem('gymCalMonth', '99x'); });
        await openCalendar(page);
        await expect(page.locator('.cal-title')).toHaveText(CAL_MONTHS[now.getMonth()] + ' ' + now.getFullYear());
        /* [UX-I17] gymCalMonth больше не пишется (§12.8): миграция — разовое чтение;
           разрешённая дата (месяц последней тренировки = текущий) записана в gymCalDate */
        const saved = await page.evaluate(function () { return localStorage.getItem('gymCalDate'); });
        expect(saved).toBe(today);
    });

    test('§14.11 «сегодня»: рамка+фон; с активной — полая точка', async ({ page, request }) => {
        const now = new Date();
        const today = isoDate(now);
        await seedWorkouts(request, [
            workoutAt(1, today, '09:30:00', '10:30:00', EX),
            { id: 2, date: today, started: today + 'T18:10:00', ended: '', finished: false, title: '', nutrition: '',
                exercises: [{ name: EX, st: today + 'T18:11:00', en: '', sets: [{ w: '60', s: 2, r: '10', t: today + 'T18:12:00' }] }] }
        ]);
        await openApp(page);
        await openCalendar(page);
        const todayCell = page.locator('.cal-d.today');
        await expect(todayCell).toHaveCount(1);
        await expect(todayCell).toHaveAttribute('data-a', today);
        /* 2 тренировки: завершённая (заливка) + активная (кольцо) [§5] */
        await expect(todayCell.locator('.dot')).toHaveCount(2);
        await expect(todayCell.locator('.dot.hollow')).toHaveCount(1);
    });

    test('§14.12 пустой месяц (есть ранние): честный текст, БЕЗ подсказок (заготовка выключена), «Сегодня» видна', async ({ page, request }) => {
        const now = new Date();
        const ym2 = monthShift(-2);
        await seedWorkouts(request, [
            workoutAt(1, isoOf(ym2, 26), '09:30:00', '10:30:00', EX),
            workoutAt(2, isoOf(ym2, 26), '09:30:00', '10:30:00', EX),
            workoutAt(3, isoDate(now), '09:30:00', '10:30:00', EX)
        ]);
        await openApp(page);
        await openCalendar(page);
        await page.locator('[data-act="calPrev"]').click();
        const ym1 = monthShift(-1);
        await expect(page.locator('.calempty')).toHaveText('В ' + CAL_MONTHS_PREP[ym1.m] + ' тренировок не было.');
        await expect(page.locator('.calhint')).toHaveCount(0);
        await expect(page.locator('.cal-today')).toBeVisible();
        await page.locator('.cal-today').click();
        await expect(page.locator('.cal-title')).toHaveText(CAL_MONTHS[now.getMonth()] + ' ' + now.getFullYear());
    });

    test('§14.13 пустой месяц (ранних нет): текст без подсказок, «Сегодня» возвращает к точке', async ({ page, request }) => {
        const now = new Date();
        const day25 = isoOf({ y: now.getFullYear(), m: now.getMonth() }, 25);
        await seedWorkouts(request, [workoutAt(1, day25, '09:30:00', '10:30:00', EX)]);
        await openApp(page);
        await openCalendar(page);
        await page.locator('[data-act="calPrev"]').click();
        const ym1 = monthShift(-1);
        await expect(page.locator('.calempty')).toHaveText('В ' + CAL_MONTHS_PREP[ym1.m] + ' тренировок не было.');
        await expect(page.locator('.calhint')).toHaveCount(0);
        await expect(page.locator('.cal-today')).toBeVisible();
        await page.locator('.cal-today').click();
        await expect(page.locator('.cal-d.has')).toHaveCount(1);
        await expect(page.locator('.cal-d[data-a="' + day25 + '"] .dot')).toHaveCount(1);
    });

    test('§14.14 ноль тренировок: «Пока нет тренировок», пилюли нет, hero Истории не изменился', async ({ page }) => {
        await openApp(page);
        await expect(page.locator('#app .hero', { hasText: 'Пока пусто' })).toBeVisible();
        await openCalendar(page);
        await expect(page.locator('.calempty')).toHaveText('Пока нет тренировок');
        /* месяц дефолтный = текущий → «Сегодня» нет [S6-update2] */
        await expect(page.locator('.cal-today')).toHaveCount(0);
        await page.locator('.topbar [data-act="closeCal"]').click();
        await expect(page.locator('#app .hero', { hasText: 'Пока пусто' })).toBeVisible();
    });

    test('§14.15 битая дата: в списке есть, в календаре точки нет, ошибок в консоли нет', async ({ page, request }) => {
        const consoleErrors = [];
        page.on('console', function (m) { if (m.type() === 'error') consoleErrors.push(m.text()); });
        const broken = workoutAt(1, '', '09:30:00', '10:30:00', EX);
        broken.date = '';
        await seedWorkouts(request, [broken]);
        await openApp(page);
        await expect(page.locator('.pcard').first()).toBeVisible();
        await openCalendar(page);
        await expect(page.locator('.cal-d.has')).toHaveCount(0);
        expect(consoleErrors).toEqual([]);
    });

    test('§14.16 320px: сетка без горизонтального скролла, 7 колонок, topbar в одну строку', async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 640 });
        await openApp(page);
        await openCalendar(page);
        const sw = await page.evaluate(function () { return document.documentElement.scrollWidth; });
        expect(sw).toBeLessThanOrEqual(320);
        const cols = await page.evaluate(function () {
            return getComputedStyle(document.querySelector('.cal-grid')).gridTemplateColumns.split(' ').length;
        });
        expect(cols).toBe(7);
        const gw = await page.locator('.cal-grid').boundingBox();
        expect(gw.width).toBeLessThanOrEqual(296);
        /* topbar с двумя кнопками в одну строку */
        const tb = await page.locator('.topbar').boundingBox();
        expect(tb.height).toBeLessThan(70);
    });

    test('§14.17 предел вперёд = декабрь 2030: › disabled, ‹ активна', async ({ page, request }) => {
        const today = isoDate(new Date());
        await seedWorkouts(request, [workoutAt(1, today, '09:30:00', '10:30:00', EX)]);
        await openApp(page);
        await page.evaluate(function () { localStorage.setItem('gymCalMonth', '2030-12'); });
        await openCalendar(page);
        await expect(page.locator('.cal-title')).toHaveText('Декабрь 2030');
        const nextBtn = page.locator('[data-act="calNext"]');
        await expect(nextBtn).toBeDisabled();
        await expect(nextBtn).toHaveAttribute('aria-disabled', 'true');
        await expect(page.locator('[data-act="calPrev"]')).toBeEnabled();
    });

    test('§14.18 будущий месяц пуст: честный текст + «Сегодня», возврат к точке тренировки', async ({ page, request }) => {
        const now = new Date();
        const today = isoDate(now);
        await seedWorkouts(request, [workoutAt(1, today, '09:30:00', '10:30:00', EX)]);
        await openApp(page);
        await openCalendar(page);
        await page.locator('[data-act="calNext"]').click();
        const nextYm = monthShift(1);
        await expect(page.locator('.cal-title')).toHaveText(CAL_MONTHS[nextYm.m] + ' ' + nextYm.y);
        await expect(page.locator('.cal-d.has')).toHaveCount(0);
        await expect(page.locator('.calempty')).toHaveText('В ' + CAL_MONTHS_PREP[nextYm.m] + ' тренировок не было.');
        await expect(page.locator('.cal-today')).toBeVisible();
        await page.locator('.cal-today').click();
        await expect(page.locator('.cal-title')).toHaveText(CAL_MONTHS[now.getMonth()] + ' ' + now.getFullYear());
        await expect(page.locator('.cal-d[data-a="' + today + '"] .dot')).toHaveCount(1);
    });

    test('§14.19 заготовка подсказки: SHOW_MONTH_HINTS=false — .calhint нет; ветка рендера в коде есть', async ({ page, request }) => {
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
        /* флаг выключен решением владельца [S6-update3 09.11] */
        expect(src).toContain('const SHOW_MONTH_HINTS = false;');
        /* рендер-ветка написана (заготовка), но под флагом */
        expect(src).toContain('if (SHOW_MONTH_HINTS && G.workouts.length)');
        expect(src).toContain('Предыдущая тренировка — ');
        const now = new Date();
        const ym2 = monthShift(-2);
        await seedWorkouts(request, [
            workoutAt(1, isoOf(ym2, 26), '09:30:00', '10:30:00', EX),
            workoutAt(2, isoDate(now), '09:30:00', '10:30:00', EX)
        ]);
        await openApp(page);
        await openCalendar(page);
        await page.locator('[data-act="calPrev"]').click();
        await expect(page.locator('.calempty')).toBeVisible();
        await expect(page.locator('.calhint')).toHaveCount(0);
    });

    test('§14.19б (доп.) SHOW_MONTH_HINTS=true (рантайм-патч): подсказка «Предыдущая тренировка — …» появляется, без года', async ({ page, request }) => {
        /* флаг — const в замыкании app.js, в рантайме не переворачивается: патчим тело
           app.js в ответе тест-сервера, чтобы рендер-ветка [§14.19] реально отработала */
        await page.route('**/app.js*', async function (route) {
            const resp = await route.fetch();
            const body = (await resp.text()).replace('const SHOW_MONTH_HINTS = false', 'const SHOW_MONTH_HINTS = true');
            await route.fulfill({ response: resp, body: body });
        });
        const now = new Date();
        const ym2 = monthShift(-2);
        await seedWorkouts(request, [
            workoutAt(1, isoOf(ym2, 26), '09:30:00', '10:30:00', EX),
            workoutAt(2, isoOf(ym2, 29), '09:30:00', '10:30:00', EX),
            workoutAt(3, isoDate(now), '09:30:00', '10:30:00', EX)
        ]);
        await openApp(page);
        await openCalendar(page);
        await page.locator('[data-act="calPrev"]').click();
        const ym1 = monthShift(-1);
        await expect(page.locator('.calempty')).toHaveText('В ' + CAL_MONTHS_PREP[ym1.m] + ' тренировок не было.');
        /* подсказка = последняя тренировка до 1-го числа просматриваемого месяца
           (29-е ym2, не 26-е), формат «<день> <месяц>» БЕЗ года [§14.19] */
        await expect(page.locator('.calhint')).toHaveText('Предыдущая тренировка — 29 ' + CAL_MONTHS_GEN[ym2.m]);
        /* пилюля «Сегодня» рядом с подсказкой работает */
        await page.locator('.cal-today').click();
        await expect(page.locator('.cal-title')).toHaveText(CAL_MONTHS[now.getMonth()] + ' ' + now.getFullYear());
        await expect(page.locator('.calhint')).toHaveCount(0);
    });

    test('§14.20 компактная высота: .cal-d = 38px (компакт v3), регресс от возврата 44px и отката к 30/35px', async ({ page, request }) => {
        const today = isoDate(new Date());
        await seedWorkouts(request, [workoutAt(1, today, '09:30:00', '10:30:00', EX)]);
        await openApp(page);
        /* фиксируем ноябрь 2026 (1-е — воскресенье → 6 заглушек): на текущем месяце
           заглушек может не быть (месяц с понедельника) — boundingBox вернул бы null.
           Высоты от месяца не зависят [§4.3]; gymCalMonth читается при openCal [§7.3] */
        await page.evaluate(function () { localStorage.setItem('gymCalMonth', '2026-11'); });
        await openCalendar(page);
        await expect(page.locator('.cal-title')).toHaveText('Ноябрь 2026');
        /* высота ячейки дня = ровно 38px [§4.3; на 30px кольцо активной заходило на цифру] */
        const cell = await page.locator('.cal-d[data-a="2026-11-15"]').boundingBox();
        expect(cell.height).toBe(38);
        /* заглушка смежного месяца — той же высоты [§4.2] */
        const blank = await page.locator('.cal-blank').first().boundingBox();
        expect(blank.height).toBe(38);
        /* кнопки ‹/› — 32×32 (компакт v3) */
        const nav = await page.locator('.cal-navbtn').first().boundingBox();
        expect(nav.height).toBe(32);
        expect(nav.width).toBe(32);
    });

    /* ниже — усиление тестировщика сверх 20 кейсов спецификации [§14]: переход через
       границу годов стрелкой и полая точка активной тренировки ВНЕ сегодняшней клетки */
    test('доп.1 граница годов: декабрь 2020 → январь 2021 стрелкой и назад, сетка Пн-старт не ломается', async ({ page, request }) => {
        await seedWorkouts(request, [workoutAt(1, '2020-12-31', '09:30:00', '10:30:00', EX)]);
        await openApp(page);
        /* дефолтный месяц = месяц последней тренировки = декабрь 2020 [§7.3] */
        await openCalendar(page);
        await expect(page.locator('.cal-title')).toHaveText('Декабрь 2020');
        /* 1 декабря 2020 — вторник: 1 заглушка (Пн), 31 день, точка на 31-м */
        await expect(page.locator('.cal-blank')).toHaveCount(1);
        await expect(page.locator('.cal-d').first()).toHaveAttribute('data-a', '2020-12-01');
        await expect(page.locator('.cal-d').last()).toHaveAttribute('data-a', '2020-12-31');
        await expect(page.locator('.cal-d[data-a="2020-12-31"] .dot')).toHaveCount(1);
        await expect(page.locator('.cal-today')).toBeVisible();
        await expect(page.locator('[data-act="calPrev"]')).toBeEnabled();
        /* › через границу года → январь 2021 */
        await page.locator('[data-act="calNext"]').click();
        await expect(page.locator('.cal-title')).toHaveText('Январь 2021');
        /* 1 января 2021 — пятница: 4 заглушки (Пн-Чт) */
        await expect(page.locator('.cal-blank')).toHaveCount(4);
        await expect(page.locator('.cal-d').first()).toHaveAttribute('data-a', '2021-01-01');
        await expect(page.locator('.cal-d').last()).toHaveAttribute('data-a', '2021-01-31');
        await expect(page.locator('.cal-d.has')).toHaveCount(0);
        await expect(page.locator('.calempty')).toHaveText('В январе тренировок не было.');
        await expect(page.locator('.cal-today')).toBeVisible();
        await expect(page.locator('[data-act="calPrev"]')).toBeEnabled();
        await expect(page.locator('[data-act="calNext"]')).toBeEnabled();
        /* [UX-I17] память теперь в gymCalDate (§2.1): стрелки месяца ставят
           date = 1-е число соседнего месяца [§2.3] — год пережит */
        const saved = await page.evaluate(function () { return localStorage.getItem('gymCalDate'); });
        expect(saved).toBe('2021-01-01');
        /* ‹ назад через границу → декабрь 2020, точка на месте */
        await page.locator('[data-act="calPrev"]').click();
        await expect(page.locator('.cal-title')).toHaveText('Декабрь 2020');
        await expect(page.locator('.cal-d[data-a="2020-12-31"] .dot')).toHaveCount(1);
    });

    test('доп.2 полая точка активной тренировки вне сегодняшней клетки: hollow, «идёт тренировка»', async ({ page, request }) => {
        const now = new Date();
        const ym = monthShift(-1);
        const dayPrev = isoOf(ym, 15); /* 15-е число прошлого месяца — никогда не сегодня */
        await seedWorkouts(request, [
            { id: 1, date: dayPrev, started: dayPrev + 'T08:00:00', ended: '', finished: false, title: '', nutrition: '',
                exercises: [{ name: EX, st: dayPrev + 'T08:01:00', en: '', sets: [{ w: '60', s: 2, r: '10', t: dayPrev + 'T08:02:00' }] }] },
            workoutAt(2, isoDate(now), '09:30:00', '10:30:00', EX)
        ]);
        await openApp(page);
        await openCalendar(page);
        /* дефолт = текущий месяц (последняя тренировка сегодня) → ‹ в прошлый */
        await page.locator('[data-act="calPrev"]').click();
        await expect(page.locator('.cal-title')).toHaveText(CAL_MONTHS[ym.m] + ' ' + ym.y);
        const cell = page.locator('.cal-d[data-a="' + dayPrev + '"]');
        await expect(cell).toHaveClass(/has/);
        await expect(cell).not.toHaveClass(/\btoday\b/);
        /* ровно одна точка и она полая (finished=false) [§5] */
        await expect(cell.locator('.dot')).toHaveCount(1);
        await expect(cell.locator('.dot.hollow')).toHaveCount(1);
        await expect(cell).toHaveAttribute('aria-label', '15 ' + CAL_MONTHS_GEN[ym.m] + ', идёт тренировка');
    });
});

/* ===== [UX-I17][UX-T39] T4: пикер вида, День/3 дня/Неделя/Год, скролл-матрица, 320px =====
   Спека docs/spec-ux-i17-week-view.md rev.3. Тесты, зависящие от ширины (порог дорожек
   §3.4 «≥34px → с текстом»), задают viewport 360/320 явно — порог считается по живой
   ширине DOM и на десктоп-проекте проверяет ту же узкую геометрию [§3.4, §10.8] */
test.describe('[UX-I17] T4: пикер видов, сеточные виды, Год, скролл, 320px', function () {

    const CAL_DOW_FULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
    /* сид одним POST /api/save (как в S6-блоке выше) */
    async function seedCal(request, workouts) {
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: workouts.reduce(function (mx, w) { return Math.max(mx, w.id + 1); }, 1),
            del: [], workouts: workouts } } });
    }
    /* тренировка календаря: start/end могут быть пустыми ('' — аллдей-капсула; пустой
       ended — блок условно 1 час), finished по умолчанию true */
    function calW(id, day, start, end, name, finished) {
        return { id: id, date: day, started: start ? day + 'T' + start : '', ended: end ? day + 'T' + end : '', finished: finished !== false,
            title: '', nutrition: '',
            exercises: [{ name: name, st: day + 'T' + (start || '10:00:00'), en: day + 'T' + (end || '11:00:00'),
                sets: [{ w: '60', s: 3, r: '8-10', t: day + 'T' + (start || '10:00:00') }] }] };
    }
    /* открытие календаря в ЛЮБОМ виде: вид/дата заданы ключами localStorage ДО тапа */
    async function openCalAny(page) {
        await page.locator('.topbar [data-act="openCal"]').click();
        await expect(page.locator('.card.cal')).toBeVisible({ timeout: 5000 });
    }
    /* смена вида через пикер: тюнеры → нижний лист → пункт */
    async function pickView(page, label) {
        await page.locator('.topbar [data-act="openCalPicker"]').click();
        const sheet = page.locator('.modal.open');
        await expect(sheet).toBeVisible({ timeout: 5000 });
        await sheet.locator('.pli', { hasText: label }).click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
    }
    function gridTop(page) {
        return page.evaluate(function () { return document.getElementById('wkScroll').scrollTop; });
    }

    test('T4.1 пикер вида: 5 активных пунктов (Год без «скоро»), отметка текущего, переключение с сохранением даты', async ({ page }) => {
        await openApp(page);
        await page.evaluate(function () {
            localStorage.setItem('gymCalView', 'week');
            localStorage.setItem('gymCalDate', '2026-02-15'); /* воскресенье */
        });
        await openCalAny(page);
        await expect(page.locator('.cal-title')).toHaveText('9–15 февраля');
        /* пикер: нижний лист, 5 пунктов, все — активные кнопки, «скоро» нет [UX-T38, §2.5] */
        await page.locator('.topbar [data-act="openCalPicker"]').click();
        const sheet = page.locator('.modal.open');
        await expect(sheet.locator('.sh-title')).toHaveText('Вид календаря');
        const items = sheet.locator('.pli');
        await expect(items).toHaveCount(5);
        await expect(items).toHaveText(['День', '3 дня', 'Неделя', 'Месяц', 'Год']);
        await expect(sheet).not.toContainText('скоро');
        for (let i = 0; i < 5; i++) await expect(items.nth(i)).toBeEnabled();
        /* отметка текущего: класс .on + точка .cur — ровно одна [§9.1] */
        await expect(sheet.locator('.pli.on')).toHaveCount(1);
        await expect(sheet.locator('.pli.on')).toHaveText('Неделя');
        await expect(sheet.locator('.pli.on .cur')).toHaveCount(1);
        /* переключение на «День» — дата сохраняется [§2.3] */
        await items.nth(0).click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await expect(page.locator('.wk-days')).toBeVisible();
        await expect(page.locator('.cal-title')).toHaveText('Воскресенье, 15 февраля');
        const state = await page.evaluate(function () {
            return { v: localStorage.getItem('gymCalView'), d: localStorage.getItem('gymCalDate') };
        });
        expect(state.v).toBe('day');
        expect(state.d).toBe('2026-02-15');
        /* отметка переехала на «День» */
        await page.locator('.topbar [data-act="openCalPicker"]').click();
        await expect(page.locator('.modal.open .pli.on')).toHaveText('День');
    });

    test('T4.2 дефолт: чистый localStorage → вид «Неделя» (§12.2), gymCalDate = сегодня, полоса 7 ячеек окна над колонками', async ({ page, request }) => {
        const now = new Date();
        await seedCal(request, [calW(1, isoDate(now), '10:00:00', '11:00:00', EX)]);
        await openApp(page);
        await page.evaluate(function () {
            localStorage.removeItem('gymCalView');
            localStorage.removeItem('gymCalDate');
            localStorage.removeItem('gymCalMonth');
        });
        await page.locator('.topbar [data-act="openCal"]').click();
        await expect(page.locator('.wk-days')).toBeVisible({ timeout: 5000 });
        /* сетка месячного вида не рисуется — это именно Неделя */
        await expect(page.locator('.cal-grid')).toHaveCount(0);
        const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
        const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
        const t = mon.getMonth() === sun.getMonth()
            ? mon.getDate() + '–' + sun.getDate() + ' ' + CAL_MONTHS_GEN[mon.getMonth()]
            : mon.getDate() + ' ' + CAL_MONTHS_GEN[mon.getMonth()] + ' – ' + sun.getDate() + ' ' + CAL_MONTHS_GEN[sun.getMonth()];
        await expect(page.locator('.cal-title')).toHaveText(t);
        /* ключи записаны при первом открытии [§2.1] */
        const state = await page.evaluate(function () {
            return { v: localStorage.getItem('gymCalView'), d: localStorage.getItem('gymCalDate') };
        });
        expect(state.v).toBe('week');
        expect(state.d).toBe(isoDate(now));
        /* полоса = дни окна: 7 ячеек Пн–Вс; якорь и сегодня — одна ячейка [§12.10] */
        await expect(page.locator('.wd')).toHaveCount(7);
        await expect(page.locator('.wd.sel')).toHaveAttribute('data-a', isoDate(now));
        await expect(page.locator('.wd.today')).toHaveAttribute('data-a', isoDate(now));
        /* winpill удалена рев. 4 [UX-B14] — страховка от реинтродукции [§2.4] */
        await expect(page.locator('.winpill')).toHaveCount(0);
        /* канвас = 24 × 88 (§2.2) */
        const canvas = await page.locator('.wk-inner').boundingBox();
        expect(canvas.height).toBe(24 * 88);
        /* выравнивание 1:1: центр ячейки «сегодня» ≈ центр колонки сетки — блок (delta ≤ 3px) [§2.4, UX-B14] */
        const cell = await page.locator('.wd.today').boundingBox();
        const blk = await page.locator('.wblk').boundingBox();
        expect(Math.abs(cell.x + cell.width / 2 - (blk.x + blk.width / 2))).toBeLessThanOrEqual(3);
        /* на «своей» неделе пилюли «Сегодня» нет [§9.2] */
        await expect(page.locator('.todayfab')).toHaveCount(0);
    });

    test('T4.3 миграция: старый gymCalMonth без gymCalDate → Неделя от 1-го числа сохранённого месяца (§12.8)', async ({ page }) => {
        await openApp(page);
        await page.evaluate(function () { localStorage.setItem('gymCalMonth', '2026-02'); });
        await page.locator('.topbar [data-act="openCal"]').click();
        await expect(page.locator('.wk-days')).toBeVisible({ timeout: 5000 });
        /* 1.02.2026 — воскресенье: неделя Пн 26.01 – Вс 01.02, заголовок через месяц [§2.2] */
        await expect(page.locator('.cal-title')).toHaveText('26 января – 1 февраля');
        const state = await page.evaluate(function () {
            return { v: localStorage.getItem('gymCalView'), d: localStorage.getItem('gymCalDate') };
        });
        expect(state.v).toBe('week');
        expect(state.d).toBe('2026-02-01');
    });

    test('T4.4 Неделя (360px): пересечение — .wbar без текста, одиночный блок с текстом; тап полосы → карточка', async ({ page, request }) => {
        await page.setViewportSize({ width: 360, height: 740 });
        const today = isoDate(new Date());
        await seedCal(request, [
            calW(1, today, '10:00:00', '11:30:00', 'Кроссфит'),
            calW(2, today, '11:00:00', '12:30:00', 'Велосипед'),
            calW(3, today, '18:00:00', '19:00:00', 'Жим штанги лёжа')
        ]);
        await openApp(page);
        await page.locator('.topbar [data-act="openCal"]').click();
        await expect(page.locator('.wk-days')).toBeVisible({ timeout: 5000 });
        /* порог §3.4 на 360px: колонка ≈38.6px → пересечение (k=2, дорожка ≈18px) —
           две полосы .wbar без текста, одиночный блок (≥34px) — .wblk со временем */
        await expect(page.locator('.wbar')).toHaveCount(2);
        await expect(page.locator('.wblk')).toHaveCount(1);
        const bar = page.locator('.wbar').first();
        await expect(bar).toHaveAttribute('aria-label', /.+/);
        expect((await bar.textContent()) || '').toBe('');
        await expect(page.locator('.wblk', { hasText: '18:00' })).toHaveCount(1);
        /* тап полосы (кнопка) → карточка; «Назад» возвращает в Неделю той же недели */
        await bar.click();
        await expect(page.locator('#w1')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.bb-back')).toBeVisible();
        await page.locator('.bb-back').click();
        await expect(page.locator('.wk-days')).toBeVisible({ timeout: 5000 });
    });

    test('T4.5 День: .wide с диапазоном («23:30–24:00», не «24:30»), пересечения — дорожки с текстом, полоса 1 ячейка над колонкой, стрелки ±1', async ({ page, request }) => {
        await page.setViewportSize({ width: 360, height: 740 });
        await seedCal(request, [
            calW(1, '2026-02-14', '09:00:00', '10:00:00', 'Жим штанги лёжа'),
            calW(2, '2026-02-14', '15:00:00', '16:30:00', 'Кроссфит'),
            calW(3, '2026-02-14', '15:30:00', '17:00:00', 'Велосипед'),
            calW(4, '2026-02-14', '23:30:00', '', 'Ночная смена') /* пустой ended → условно 1ч */
        ]);
        await openApp(page);
        await page.evaluate(function () {
            localStorage.setItem('gymCalView', 'day');
            localStorage.setItem('gymCalDate', '2026-02-14'); /* суббота */
        });
        await openCalAny(page);
        await expect(page.locator('.cal-title')).toHaveText('Суббота, 14 февраля');
        /* полоса = окно вида: ровно 1 ячейка выбранного дня на всю ширину сетки [§12.10] */
        await expect(page.locator('.wd')).toHaveCount(1);
        await expect(page.locator('.wd.sel')).toHaveAttribute('data-a', '2026-02-14');
        await expect(page.locator('.wd .dw')).toHaveText('Сб');
        /* выравнивание 1:1: центр ячейки полосы ≈ центр колонки сетки (блок 09:00, delta ≤ 3px) [§2.4, UX-B14] */
        const cell = await page.locator('.wd').boundingBox();
        const blk = await page.locator('.wblk.wide').first().boundingBox();
        expect(Math.abs(cell.x + cell.width / 2 - (blk.x + blk.width / 2))).toBeLessThanOrEqual(3);
        /* канвас = 24 × 112 (§2.2) */
        const canvas = await page.locator('.wk-inner').boundingBox();
        expect(canvas.height).toBe(24 * 112);
        /* все 4 блока широкие .wide с диапазоном времени [§4] */
        await expect(page.locator('.wblk.wide')).toHaveCount(4);
        await expect(page.locator('.wblk.wide', { hasText: '09:00–10:00' })).toHaveCount(1);
        /* clamp конца: 23:30 без ended → «23:30–24:00», «24:30» не показываем [UX-T39] */
        await expect(page.locator('.wblk.wide', { hasText: '23:30–24:00' })).toHaveCount(1);
        await expect(page.locator('.wblk', { hasText: '24:30' })).toHaveCount(0);
        /* пересечение: 2 дорожки, обе с текстом (дорожка ≈140px ≥ 34), рядом, не друг на друге */
        await expect(page.locator('.wbar')).toHaveCount(0);
        const t1 = page.locator('.wblk', { hasText: '15:00–16:30' });
        const t2 = page.locator('.wblk', { hasText: '15:30–17:00' });
        await expect(t1).toHaveCount(1);
        await expect(t2).toHaveCount(1);
        const b1 = await t1.boundingBox();
        const b2 = await t2.boundingBox();
        expect(b1.width).toBeGreaterThan(100);
        expect(b2.x).toBeGreaterThan(b1.x);
        /* стрелки ±1 [§2.3] */
        await page.locator('[data-act="calPrev"]').click();
        await expect(page.locator('.cal-title')).toHaveText('Пятница, 13 февраля');
        await page.locator('[data-act="calNext"]').click();
        await expect(page.locator('.cal-title')).toHaveText('Суббота, 14 февраля');
    });

    test('T4.6 3 дня: полоса 3 ячейки окна (край недели — СБ ВС ПН, clamp исчез [§12.10]); аллдей-капсулы только в днях окна', async ({ page, request }) => {
        await seedCal(request, [
            calW(1, '2026-02-10', '', '', 'Растяжка'), /* Вт: вне окна */
            calW(2, '2026-02-14', '', '', 'Зарядка'), /* Сб: в окне */
            calW(3, '2026-02-15', '', '', 'Отжимания'), /* Вс: в окне */
            calW(4, '2026-02-17', '', '', 'Кардио'), /* Вт следующей недели: в окне 16–18 */
            calW(5, '2026-02-14', '17:34:00', '18:34:00', 'Вечерний бег') /* блок в колонке Сб [UX-B14] */
        ]);
        await openApp(page);
        await page.evaluate(function () {
            localStorage.setItem('gymCalView', 'd3');
            localStorage.setItem('gymCalDate', '2026-02-14'); /* суббота — окно у края недели */
        });
        await openCalAny(page);
        await expect(page.locator('.cal-title')).toHaveText('14–16 февраля');
        /* полоса = окно: ровно 3 ячейки СБ 14 / ВС 15 / ПН 16 — окно переходит через
           неделю; капсула и её clamp у края недели больше не существуют (полоса = окно) [§12.10] */
        const cells = page.locator('.wd');
        await expect(cells).toHaveCount(3);
        /* winpill удалена рев. 4 [UX-B14] — страховка от реинтродукции [§2.4] */
        await expect(page.locator('.winpill')).toHaveCount(0);
        await expect(cells.nth(0)).toHaveAttribute('data-a', '2026-02-14');
        await expect(cells.nth(1)).toHaveAttribute('data-a', '2026-02-15');
        await expect(cells.nth(2)).toHaveAttribute('data-a', '2026-02-16');
        await expect(page.locator('.wd .dw')).toHaveText(['Сб', 'Вс', 'Пн']);
        /* ячейки — равные трети полосы; центр последней ≈ 5/6 ширины полосы */
        const strip = await page.locator('.wk-days').boundingBox();
        const c0 = await cells.nth(0).boundingBox();
        const c2 = await cells.nth(2).boundingBox();
        expect(Math.abs(c0.width - strip.width / 3)).toBeLessThanOrEqual(2);
        expect(Math.abs(c2.width - strip.width / 3)).toBeLessThanOrEqual(2);
        expect(Math.abs(c2.x + c2.width / 2 - (strip.x + strip.width * 5 / 6))).toBeLessThanOrEqual(3);
        /* выравнивание 1:1: блок «Вечерний бег» (17:34) ровно под ячейкой «СБ 14» (delta ≤ 3px) [UX-B14] */
        const blk = await page.locator('.wblk').boundingBox();
        expect(Math.abs(c0.x + c0.width / 2 - (blk.x + blk.width / 2))).toBeLessThanOrEqual(3);
        /* канвас = 24 × 96 (§2.2) */
        const canvas = await page.locator('.wk-inner').boundingBox();
        expect(canvas.height).toBe(24 * 96);
        /* аллдей: капсулы только в днях окна (14, 15); 10-е вне окна, 17-е ещё не в окне [§3.5] */
        await expect(page.locator('.adpill')).toHaveCount(2);
        await expect(page.locator('.adpill', { hasText: 'Зарядка' })).toHaveCount(1);
        await expect(page.locator('.adpill', { hasText: 'Отжимания' })).toHaveCount(1);
        /* ‹ ±3 дня → окно 11–13 целиком внутри недели: полоса СР/ЧТ/ПТ, аллдей нет */
        await page.locator('[data-act="calPrev"]').click();
        await expect(page.locator('.cal-title')).toHaveText('11–13 февраля');
        await expect(page.locator('.wd')).toHaveCount(3);
        await expect(page.locator('.wd .dw')).toHaveText(['Ср', 'Чт', 'Пт']);
        await expect(page.locator('.adpill')).toHaveCount(0);
        /* › и тап ПН 16 в полосе → окно 16–18 (полоса ПН/ВТ/СР уходит на следующую
           неделю): из безвременных видна только «Кардио» (17-е теперь в окне) */
        await page.locator('[data-act="calNext"]').click();
        await expect(page.locator('.cal-title')).toHaveText('14–16 февраля');
        await page.locator('.wd[data-a="2026-02-16"]').click();
        await expect(page.locator('.cal-title')).toHaveText('16–18 февраля');
        await expect(page.locator('.wd .dw')).toHaveText(['Пн', 'Вт', 'Ср']);
        await expect(page.locator('.adpill')).toHaveCount(1);
        await expect(page.locator('.adpill', { hasText: 'Кардио' })).toHaveCount(1);
    });

    test('T4.6б [UX-B14] сценарий владельца: d3 окно 19–21 (середина недели), блок 17:34 ровно под ячейкой «ЧТ 19»', async ({ page, request }) => {
        await seedCal(request, [
            calW(1, '2026-02-19', '17:34:00', '18:34:00', 'Вечерний бег')
        ]);
        await openApp(page);
        await page.evaluate(function () {
            localStorage.setItem('gymCalView', 'd3');
            localStorage.setItem('gymCalDate', '2026-02-19'); /* четверг — окно в середине недели */
        });
        await openCalAny(page);
        await expect(page.locator('.cal-title')).toHaveText('19–21 февраля');
        /* полоса = окно: ровно 3 ячейки ЧТ 19 / ПТ 20 / СБ 21 [§12.10] */
        await expect(page.locator('.wd')).toHaveCount(3);
        await expect(page.locator('.wd .dw')).toHaveText(['Чт', 'Пт', 'Сб']);
        await expect(page.locator('.wd.sel')).toHaveAttribute('data-a', '2026-02-19');
        /* winpill удалена [UX-B14] — страховка от реинтродукции [§2.4] */
        await expect(page.locator('.winpill')).toHaveCount(0);
        /* канвас = 24 × 96 (§2.2) */
        const canvas = await page.locator('.wk-inner').boundingBox();
        expect(canvas.height).toBe(24 * 96);
        /* выравнивание 1:1: центр блока 17:34 = центр ячейки «ЧТ 19» (delta ≤ 3px) [UX-B14] */
        const cell = await page.locator('.wd.sel').boundingBox();
        const blk = await page.locator('.wblk').boundingBox();
        expect(Math.abs(cell.x + cell.width / 2 - (blk.x + blk.width / 2))).toBeLessThanOrEqual(3);
    });

    test('T4.7 скролл: Неделя — тап соседнего дня той же недели сохраняет ручной скролл; возврат из карточки — та же позиция', async ({ page, request }) => {
        await page.setViewportSize({ width: 360, height: 740 });
        const now = new Date();
        const today = isoDate(now);
        const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
        /* соседний день той же недели: понедельник, а если сегодня он — вторник */
        const other = mon.getDay() === now.getDay() && mon.getDate() === now.getDate()
            ? isoDate(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 1))
            : isoDate(mon);
        await seedCal(request, [
            calW(1, today, '08:00:00', '09:00:00', 'Утро'),
            calW(2, today, '19:00:00', '20:00:00', 'Вечер')
        ]);
        await openApp(page);
        await page.locator('.topbar [data-act="openCal"]').click();
        await expect(page.locator('.wk-days')).toBeVisible({ timeout: 5000 });
        /* ручной скролл сетки */
        await page.evaluate(function () { document.getElementById('wkScroll').scrollTop = 400; });
        /* тап по дню той же недели — период не сменился, скролл на месте (ключ по понедельнику) */
        await page.locator('.wd[data-a="' + other + '"]').click();
        await expect(page.locator('.wd.sel')).toHaveAttribute('data-a', other);
        await expect(page.locator('.wd.today')).toHaveAttribute('data-a', today);
        expect(await gridTop(page)).toBe(400);
        /* тап по блоку → карточка; «Назад» — та же позиция скролла [§3.2].
           Перед тапом скроллим на 360: блок «Утро» (08:00 → top 704–792 при 88px/ч)
           полностью в окне 360–800, иначе Playwright сам центрирует блок (CDP
           scrollIntoViewIfNeeded) и pre захватит позицию Playwright, а не ручную */
        await page.evaluate(function () { document.getElementById('wkScroll').scrollTop = 360; });
        await page.locator('.wblk').first().click();
        await expect(page.locator('#w1')).toBeVisible({ timeout: 5000 });
        await page.locator('.bb-back').click();
        await expect(page.locator('.wk-days')).toBeVisible({ timeout: 5000 });
        expect(await gridTop(page)).toBe(360);
    });

    test('T4.8 скролл: День/3 дня — смена периода (стрелка/тап дня полосы) сбрасывает на автоскролл (семантика §3.2)', async ({ page, request }) => {
        await page.setViewportSize({ width: 360, height: 740 });
        await seedCal(request, [
            calW(1, '2026-02-13', '08:00:00', '09:00:00', 'Утро'),
            calW(2, '2026-02-14', '21:00:00', '22:00:00', 'Вечер')
        ]);
        await openApp(page);
        await page.evaluate(function () {
            localStorage.setItem('gymCalView', 'day');
            localStorage.setItem('gymCalDate', '2026-02-14');
        });
        await openCalAny(page);
        /* автоскролл при открытии: ранняя 21:00 → (21:00−60мин)×112px = 2240,
           clamp [0, 2688−440] не режет → 2240 */
        expect(await gridTop(page)).toBe(2240);
        await page.evaluate(function () { document.getElementById('wkScroll').scrollTop = 100; });
        /* ‹ — период сменился → автоскролл к 08:00−60мин = 7×112 = 784 (в «Дне» полоса —
           одна ячейка, другой день стрелкой [§2.3]; семантика смены периода та же §3.2) */
        await page.locator('[data-act="calPrev"]').click();
        await expect(page.locator('.cal-title')).toHaveText('Пятница, 13 февраля');
        expect(await gridTop(page)).toBe(784);
        /* «3 дня»: та же семантика (час 96px) — открытие окна 13–15: 7×96 = 672 */
        await pickView(page, '3 дня');
        await expect(page.locator('.cal-title')).toHaveText('13–15 февраля');
        expect(await gridTop(page)).toBe(672);
        await page.evaluate(function () { document.getElementById('wkScroll').scrollTop = 50; });
        /* тап 14-го в полосе (окно 13–15) → окно 14–16: в нём «Вечер» 21:00 → автоскролл
           (21:00−60мин)×96 = 1920, clamp в [0, 2304−440=1864] → 1864 (заодно clamp [§3.2]) */
        await page.locator('.wd[data-a="2026-02-14"]').click();
        await expect(page.locator('.cal-title')).toHaveText('14–16 февраля');
        expect(await gridTop(page)).toBe(1864);
    });

    test('T4.9 Год: 12 мини-месяцев, валидные дни (февраль 2024 = 29), точка .h, сегодня .t, .ym.cur', async ({ page, request }) => {
        await seedCal(request, [calW(1, '2024-02-10', '10:00:00', '11:00:00', 'Жим штанги лёжа')]);
        await openApp(page);
        await page.evaluate(function () {
            localStorage.setItem('gymCalView', 'year');
            localStorage.setItem('gymCalDate', '2024-02-10');
        });
        await openCalAny(page);
        await expect(page.locator('.cal-title')).toHaveText('2024');
        await expect(page.locator('.ym')).toHaveCount(12);
        /* февраль 2024 — високосный: ровно 29 чисел (без заглушек aria-hidden) [§8] */
        const feb = page.locator('.ym', { hasText: 'Февраль' });
        const nums = await feb.locator('.yd i:not([aria-hidden])').allTextContents();
        expect(nums.length).toBe(29);
        expect(nums[28]).toBe('29');
        /* точка .h на дне с тренировкой; якорный месяц подсвечен (регресс бага с дефисом) */
        await expect(feb.locator('.yd i.h')).toHaveCount(1);
        await expect(feb.locator('.yd i.h')).toHaveText('10');
        await expect(page.locator('.ym.cur')).toHaveCount(1);
        await expect(page.locator('.ym.cur')).toHaveClass(/cur/);
        /* стрелки ±1 год */
        await page.locator('[data-act="calNext"]').click();
        await expect(page.locator('.cal-title')).toHaveText('2025');
        await page.locator('[data-act="calPrev"]').click();
        await expect(page.locator('.cal-title')).toHaveText('2024');
        /* «Сегодня» → текущий год: ноябрь .cur, ячейка сегодняшнего дня .t [§12.9] */
        await expect(page.locator('.todayfab')).toBeVisible();
        await page.locator('.todayfab').click();
        await expect(page.locator('.cal-title')).toHaveText(String(new Date().getFullYear()));
        const cur = page.locator('.ym.cur');
        await expect(cur).toHaveCount(1);
        await expect(cur.locator('.ym-t')).toHaveText(CAL_MONTHS[new Date().getMonth()]);
        await expect(cur.locator('.yd i.t')).toHaveText(String(new Date().getDate()));
        await expect(page.locator('.todayfab')).toHaveCount(0);
    });

    test('T4.10 Год → Месяц: тап месяца якоря сохраняет дату (панель дня жива), чужой месяц — 1-е число и панель закрыта', async ({ page, request }) => {
        await seedCal(request, [calW(1, '2024-02-15', '10:00:00', '11:00:00', 'Жим штанги лёжа')]);
        await openApp(page);
        await page.evaluate(function () {
            localStorage.setItem('gymCalView', 'month');
            localStorage.setItem('gymCalDate', '2024-02-15');
        });
        await openCalAny(page);
        /* панель дня открыта тапом по 15-му */
        await page.locator('.cal-d[data-a="2024-02-15"]').click();
        await expect(page.locator('.daypanel')).toBeVisible({ timeout: 5000 });
        await pickView(page, 'Год');
        await expect(page.locator('.cal-title')).toHaveText('2024');
        /* тап по мини-месяцу ЯКОРЯ: дата сохраняется целиком (решение владельца, ТЗ #274) */
        await page.locator('.ym', { hasText: 'Февраль' }).click();
        await expect(page.locator('.cal-grid')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.cal-title')).toHaveText('Февраль 2024');
        let d = await page.evaluate(function () { return localStorage.getItem('gymCalDate'); });
        expect(d).toBe('2024-02-15');
        /* месяц не менялся — панель дня осталась жива [§2.3] */
        await expect(page.locator('.daypanel')).toBeVisible();
        /* снова Год, тап ЧУЖОГО месяца: 1-е число, панель закрыта [§2.3, §8] */
        await pickView(page, 'Год');
        await page.locator('.ym', { hasText: 'Март' }).click();
        await expect(page.locator('.cal-title')).toHaveText('Март 2024');
        d = await page.evaluate(function () { return localStorage.getItem('gymCalDate'); });
        expect(d).toBe('2024-03-01');
        await expect(page.locator('.daypanel')).toHaveCount(0);
        await expect(page.locator('.cal-d.sel')).toHaveCount(0);
    });

    test('T4.11 Год: 29.02.2024 стрелкой года → 28.02.2025 (и назад); границы 2020/2030 — стрелки disabled', async ({ page }) => {
        await openApp(page);
        await page.evaluate(function () {
            localStorage.setItem('gymCalView', 'year');
            localStorage.setItem('gymCalDate', '2024-02-29');
        });
        await openCalAny(page);
        await expect(page.locator('.cal-title')).toHaveText('2024');
        await expect(page.locator('.ym', { hasText: 'Февраль' }).locator('.yd i:not([aria-hidden])')).toHaveCount(29);
        /* +1 год: 29 февраля → 28 (невисокосный 2025) [§2.3] */
        await page.locator('[data-act="calNext"]').click();
        await expect(page.locator('.cal-title')).toHaveText('2025');
        const feb25 = page.locator('.ym', { hasText: 'Февраль' });
        const nums = await feb25.locator('.yd i:not([aria-hidden])').allTextContents();
        expect(nums.length).toBe(28);
        let d = await page.evaluate(function () { return localStorage.getItem('gymCalDate'); });
        expect(d).toBe('2025-02-28');
        /* −1 год: 2024 високосный, но 29-го в якоре уже нет — 28.02.2024 */
        await page.locator('[data-act="calPrev"]').click();
        await expect(page.locator('.cal-title')).toHaveText('2024');
        d = await page.evaluate(function () { return localStorage.getItem('gymCalDate'); });
        expect(d).toBe('2024-02-28');
        /* нижняя граница 2020: ‹ disabled + aria-disabled, › жив [§8] */
        await page.locator('[data-act="closeCal"]').click();
        await page.evaluate(function () { localStorage.setItem('gymCalDate', '2020-06-10'); });
        await openCalAny(page);
        await expect(page.locator('.cal-title')).toHaveText('2020');
        const prevBtn = page.locator('[data-act="calPrev"]');
        await expect(prevBtn).toBeDisabled();
        await expect(prevBtn).toHaveAttribute('aria-disabled', 'true');
        await expect(page.locator('[data-act="calNext"]')).toBeEnabled();
        /* верхняя граница 2030: › disabled, ‹ жив */
        await page.locator('[data-act="closeCal"]').click();
        await page.evaluate(function () { localStorage.setItem('gymCalDate', '2030-06-10'); });
        await openCalAny(page);
        await expect(page.locator('.cal-title')).toHaveText('2030');
        const nextBtn = page.locator('[data-act="calNext"]');
        await expect(nextBtn).toBeDisabled();
        await expect(nextBtn).toHaveAttribute('aria-disabled', 'true');
        await expect(page.locator('[data-act="calPrev"]')).toBeEnabled();
    });

    test('T4.12 320px (§10.8): Неделя — колонка ≈33px, одиночные блоки — полосы .wbar; без горизонтального скролла', async ({ page, request }) => {
        await page.setViewportSize({ width: 320, height: 640 });
        const today = isoDate(new Date());
        await seedCal(request, [calW(1, today, '10:00:00', '11:00:00', 'Жим штанги лёжа')]);
        await openApp(page);
        await page.locator('.topbar [data-act="openCal"]').click();
        await expect(page.locator('.wk-days')).toBeVisible({ timeout: 5000 });
        /* порог §3.4: колонка (244−14)/7 ≈ 32.9px < 34px — даже одиночный блок уходит
           в полосу без текста (отложенное T1, реализовано в T4) [§10.8] */
        await expect(page.locator('.wbar')).toHaveCount(1);
        await expect(page.locator('.wblk')).toHaveCount(0);
        expect((await page.locator('.wbar').textContent()) || '').toBe('');
        await expect(page.locator('.wbar')).toHaveAttribute('aria-label', /.+/);
        /* 320px-регресс: без горизонтального переполнения */
        const sw = await page.evaluate(function () { return document.documentElement.scrollWidth; });
        expect(sw).toBeLessThanOrEqual(320);
    });
});

/* ===== [EXR-T2] база упражнений free-exercise-db: фото вместо иконок, RU-описание ===== */
test.describe('EXR-T2: фото упражнений (free-exercise-db) в Технике', function () {

    test('у упражнения с img рендерится фото (список + деталь, 2 ракурса, описание), у упражнения без img — прежняя иконка', async ({ page, request }) => {
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Техника' }).click();
        await expect(page.locator('.tb-title')).toContainText('Техника', { timeout: 5000 });

        /* «Жим штанги лёжа» привязан к базе: фото вместо иконки в карточке списка */
        const row = page.locator('#techList .excard', { hasText: EX }).first();
        const thumb = row.locator('img.exthumb');
        await expect(thumb).toHaveAttribute('src', /img\/exercises\/bench-0\.jpg$/, { timeout: 5000 });
        await expect(row.locator('.ico')).toHaveCount(0);
        /* фото реально загрузилось и сервер отдаёт его с правильным mime */
        await thumb.scrollIntoViewIfNeeded();
        await expect.poll(async () => thumb.evaluate(function (el) { return el.naturalWidth; }), { timeout: 5000 }).toBeGreaterThan(0);
        const ct = await request.get('/img/exercises/bench-0.jpg').then(function (r) { return r.headers()['content-type']; });
        if (ct !== 'image/jpeg') throw new Error('content-type фото: ' + ct + ', ожидалось image/jpeg');

        /* [EXR-T3] «Растяжка грудных мышц» получила фото из базы (список владельца) —
           образцом «без привязки» стал «Махи в наклоне (задняя дельта)»: без img и описания */
        const plainRow = page.locator('#techList .excard', { hasText: 'Махи в наклоне (задняя дельта)' }).first();
        await expect(plainRow.locator('.ico')).toHaveCount(1, { timeout: 5000 });
        await expect(plainRow.locator('img')).toHaveCount(0);

        /* деталь привязанного упражнения: мини-фото в шапке, 2 ракурса, RU-описание, шаги техники */
        await row.click();
        await expect(page.locator('.card .exhead img.exthumb')).toHaveAttribute('src', /bench-0\.jpg$/, { timeout: 5000 });
        const photos = page.locator('.card .exphotos img');
        await expect(photos).toHaveCount(2);
        await expect(photos.nth(0)).toHaveAttribute('src', /bench-0\.jpg$/);
        await expect(photos.nth(1)).toHaveAttribute('src', /bench-1\.jpg$/);
        await expect(page.locator('.card .exdesc')).toContainText('грудн', { timeout: 5000 });
        await expect(page.locator('.card .techstep').first()).toBeVisible({ timeout: 5000 });

        /* деталь упражнения без привязки: без фото-блока и описания, иконка в шапке */
        await page.locator('[data-act="techBack"]').click();
        await page.locator('#techList .excard', { hasText: 'Махи в наклоне (задняя дельта)' }).first().click();
        await expect(page.locator('.card .exphotos')).toHaveCount(0, { timeout: 5000 });
        await expect(page.locator('.card .exdesc')).toHaveCount(0);
        await expect(page.locator('.card .exhead .ico')).toHaveCount(1);
    });

});

/* ===== [EXR-T8] фото-инфра: Cache-Control на GET /img/ + path traversal гвард ===== */
test.describe('EXR-T8: Cache-Control на img и path traversal', function () {

    test('GET img (из «Техники») и JS-статика — годовой immutable-кэш [UX-B17], было 604800/no-store', async ({ page }) => {
        /* перехват реального ответа по фото из UI (page.on('response')) */
        let imgCacheControl = null;
        page.on('response', function (r) {
            if (/\/img\/exercises\/bench-0\.jpg$/.test(r.url()) && r.status() === 200) {
                imgCacheControl = r.headers()['cache-control'] || '';
            }
        });
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Техника' }).click();
        await expect.poll(function () { return imgCacheControl; }, { timeout: 5000 })
            .toBe('public, max-age=31536000, immutable');
        /* прямой GET того же файла — та же прод-логика */
        const direct = await page.request.get('/img/exercises/bench-0.jpg');
        if (direct.headers()['cache-control'] !== 'public, max-age=31536000, immutable') {
            throw new Error('прямой GET img cache-control: ' + JSON.stringify(direct.headers()['cache-control']));
        }
        /* JS-статика тоже годовой immutable: раньше no-store — Mini App перекачивал 660KB (UX-B17) */
        const js = await page.request.get('/app.js');
        if (js.headers()['cache-control'] !== 'public, max-age=31536000, immutable') {
            throw new Error('app.js cache-control: ' + JSON.stringify(js.headers()['cache-control']) + ', ожидался годовой immutable');
        }
    });

    test('path traversal: /img/%2e%2e/app.js → 404, легитимные пути работают (сырой запрос)', async ({ baseURL }) => {
        const base = new URL(baseURL || 'http://127.0.0.1:8099');
        /* WHATWG-клиенты (fetch, Playwright request) схлопывают %2e%2e в «..» до отправки —
           гвард проверяем сырым http-запросом ровно на traversal-пути */
        function rawStatus(p) {
            return new Promise(function (resolve, reject) {
                const rq = http.request({ host: base.hostname, port: base.port, path: p, method: 'GET' }, function (rs) {
                    rs.resume();
                    rs.on('end', function () { resolve(rs.statusCode); });
                });
                rq.on('error', reject);
                rq.end();
            });
        }
        if (await rawStatus('/img/%2e%2e/app.js') !== 404) throw new Error('/img/%2e%2e/app.js: ожидался 404 (раньше отдавал соседний файл)');
        if (await rawStatus('/img/%2e%2e/%2e%2e/build.gradle') !== 404) throw new Error('траверс за пределы web/: ожидался 404');
        if (await rawStatus('/app.js') !== 200) throw new Error('легитимный /app.js сломан');
    });
});

/* ===== [UX-T32] фото вместо иконок: карточки Истории + Статистика (1ПМ, группы) ===== */
test.describe('UX-T32: фото упражнений в Истории и Статистике', function () {

    test('История: фото в шапке упражнения с img (naturalWidth>0), «своё» — прежняя иконка', async ({ page, request }) => {
        const today = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 3, del: [],
            workouts: [
                doneWorkout(1, today, EX, '60', 3),
                /* «своё» упражнение вне каталога — fallback на иконку */
                { id: 2, date: today, started: today + 'T11:00:00', ended: today + 'T11:40:00', finished: true, title: '', nutrition: '',
                    exercises: [{ name: 'Моё упражнение', st: today + 'T11:05:00', en: today + 'T11:30:00',
                        sets: [{ w: '20', s: 2, r: '10', t: today + 'T11:06:00' }] }] }
            ] } } });
        await openApp(page);
        /* карточка каталог-упражнения: фото-миниатюра (та же .exthumb-логика, что в Технике), без .ico */
        await page.locator('.pcard', { hasText: EX }).click();
        const pill = page.locator('.expill', { hasText: EX });
        const thumb = pill.locator('img.exthumb');
        await expect(thumb).toHaveAttribute('src', /img\/exercises\/bench-0\.jpg$/, { timeout: 5000 });
        await expect(pill.locator('.ico')).toHaveCount(0);
        await thumb.scrollIntoViewIfNeeded();
        await expect.poll(async () => thumb.evaluate(function (el) { return el.naturalWidth; }), { timeout: 5000 }).toBeGreaterThan(0);
        /* выход к списку, карточка «своего» упражнения: прежняя SVG-иконка, без фото */
        await page.locator('.bb-back').click();
        await page.locator('.pcard', { hasText: 'Моё упражнение' }).click();
        const own = page.locator('.expill', { hasText: 'Моё упражнение' });
        await expect(own.locator('.ico')).toHaveCount(1, { timeout: 5000 });
        await expect(own.locator('img')).toHaveCount(0);
    });

    test('Статистика: фото в «Оценка 1ПМ · Эпли» и в кружках «Мышечных групп»', async ({ page, request }) => {
        const today = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            workouts: [doneWorkout(1, today, EX, '100', 3)] } } });
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Статистика' }).click();
        /* 1ПМ: фото-миниатюра вместо иконки (жим → bench), .ico в строках нет */
        const card = page.locator('.card', { hasText: 'Оценка 1ПМ · Эпли' });
        const thumb = card.locator('.prmrow img.exthumb');
        await expect(thumb).toHaveAttribute('src', /img\/exercises\/bench-0\.jpg$/, { timeout: 5000 });
        await expect(card.locator('.prmrow .ico')).toHaveCount(0);
        await expect.poll(async () => thumb.evaluate(function (el) { return el.naturalWidth; }), { timeout: 5000 }).toBeGreaterThan(0);
        /* группы: жим = Грудь → representative-фото в цветном круге (.mgimg, круглая обрезка), svg-иконки нет */
        const mg = page.locator('.mg', { hasText: 'Грудь' });
        await expect(mg).toBeVisible({ timeout: 5000 });
        const mgimg = mg.locator('img.mgimg');
        await expect(mgimg).toHaveAttribute('src', /img\/exercises\/bench-0\.jpg$/);
        await expect(mg.locator('svg')).toHaveCount(0);
        await expect.poll(async () => mgimg.evaluate(function (el) { return el.naturalWidth; }), { timeout: 5000 }).toBeGreaterThan(0);
    });

});

/* ===== [EXR-T9] пикер: фото вместо иконок в карточках каталога ===== */
test.describe('EXR-T9: фото упражнений в пикере', function () {

    test('карточка каталога с img — фото (naturalWidth>0), «своё» — прежняя иконка; в «★ Любимых» — тоже фото', async ({ page, request }) => {
        /* сеем своё упражнение на сервере до старта — /api/init читается при рендере [EXR-T13] */
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [], workouts: [], customEx: [{ n: 'Моё упражнение', tags: [] }] } } });
        await openApp(page);
        await startWorkoutUi(page);
        await openActiveDetail(page);
        await page.locator('[data-act="openPicker"]').click();
        /* секция «Все»: карточка каталога с привязкой к базе — фото вместо иконки, .ico нет */
        await page.locator('.modal.open .secrow .chip', { hasText: 'Все' }).first().click();
        const card = page.locator('#pickerList .excard', { hasText: 'Жим штанги лёжа' }).first();
        const thumb = card.locator('img.exthumb');
        await expect(thumb).toHaveAttribute('src', /img\/exercises\/bench-0\.jpg$/, { timeout: 5000 });
        await expect(card.locator('.ico')).toHaveCount(0);
        await thumb.scrollIntoViewIfNeeded();
        await expect.poll(async () => thumb.evaluate(function (el) { return el.naturalWidth; }), { timeout: 5000 }).toBeGreaterThan(0);
        /* «своё» упражнение (без img) — прежняя SVG-иконка, без фото */
        const own = page.locator('#pickerList .excard', { hasText: 'Моё упражнение' });
        await expect(own.locator('.ico')).toHaveCount(1, { timeout: 5000 });
        await expect(own.locator('img')).toHaveCount(0);
        /* секция «★ Любимые»: карточка любимого тоже с фото, фолбэк не вернулся */
        await card.locator('.star').click();
        await page.locator('.modal.open .secrow .chip', { hasText: 'Любимые' }).click();
        const fav = page.locator('#pickerList .excard', { hasText: 'Жим штанги лёжа' }).first();
        await expect(fav.locator('img.exthumb')).toHaveAttribute('src', /bench-0\.jpg$/, { timeout: 5000 });
        await expect(fav.locator('.ico')).toHaveCount(0);
        /* «Коллекции» → «Свои»: своя карточка через exCardByName — тоже иконка */
        await page.locator('.modal.open .secrow .chip', { hasText: 'Коллекции' }).click();
        await page.locator('.modal.open #pickerCats .chip', { hasText: 'Свои' }).click();
        const ownColl = page.locator('#pickerList .excard', { hasText: 'Моё упражнение' });
        await expect(ownColl.locator('.ico')).toHaveCount(1, { timeout: 5000 });
        await expect(ownColl.locator('img')).toHaveCount(0);
    });

});

/* ===== [EXR-T11/T12] контент: вариации тяг для спины (каталог 243→254) + фото/фолбэк ===== */
test.describe('EXR-T11/T12: вариации тяг для спины (контент + фото)', function () {

    test('«Спина» показывает новые вариации тяг (11 id); с img — фото (naturalWidth>0), без img — иконка-fallback и карточка с текстами', async ({ page }) => {
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Техника' }).click();
        /* контент-рост 243→254 виден пользователю: «Все» — весь каталог [EXR-T11] */
        await expect(page.locator('.card .secrow .chip', { hasText: 'Все' })).toHaveClass(/on/, { timeout: 5000 });
        const total = await page.locator('#techList .excard').count();
        if (total !== 254) throw new Error('каталог в «Технике»: ' + total + ' карточек, ожидалось 254 (243 + 11 вариаций тяг [EXR-T11])');
        /* фильтр «Группы мышц» → «Спина»: прежние 24 + 11 новых = 35 */
        await page.locator('.card .secrow .chip', { hasText: 'Группы мышц' }).click();
        await page.locator('.modal.open .frow', { hasText: 'Спина' }).click();
        await page.locator('.modal.open .btnrow .btn', { hasText: 'Применить' }).click();
        await expect(page.locator('.card .secrow .chip', { hasText: 'Группы мышц' })).toHaveClass(/on/, { timeout: 5000 });
        const back = await page.locator('#techList .excard').count();
        if (back !== 35) throw new Error('фильтр «Спина»: ' + back + ' карточек, ожидалось 35 (24 + 11 новых)');
        /* ID-уровень: новые вариации обеих семей в отфильтрованном списке */
        for (const id of ['latpullneutral', 'latpullparallelclose', 'latpullwide',
            'horizrowneutral', 'horizrowparallelclose', 'horizrowwide', 'horizrowrev', 'pullupparallel']) {
            await expect(page.locator('#techList .excard[data-a="' + id + '"]')).toBeVisible({ timeout: 5000 });
        }
        /* [EXR-T12] у записей с img — фото, и не перепутаны: src = <id>-0.jpg, реально декодируется */
        for (const id of ['latpullneutral', 'latpullrev', 'latpullparallelclose', 'horizrowneutral', 'pullupparallel']) {
            const card = page.locator('#techList .excard[data-a="' + id + '"]');
            const thumb = card.locator('img.exthumb');
            await expect(thumb).toHaveAttribute('src', new RegExp('img\\/exercises\\/' + id + '-0\\.jpg$'), { timeout: 5000 });
            await expect(card.locator('.ico')).toHaveCount(0);
            await thumb.scrollIntoViewIfNeeded();
            await expect.poll(async () => thumb.evaluate(function (el) { return el.naturalWidth; }), { timeout: 5000 }).toBeGreaterThan(0);
        }
        /* записи без img не деградировали: прежняя SVG-иконка, тега img нет */
        for (const id of ['latpullwide', 'latpullparallelmid', 'horizrowparallelclose', 'horizrowparallelmid', 'horizrowwide', 'horizrowrev']) {
            const card = page.locator('#techList .excard[data-a="' + id + '"]');
            await expect(card.locator('.ico')).toHaveCount(1, { timeout: 5000 });
            await expect(card.locator('img')).toHaveCount(0);
        }
        /* карточка без фото (horizrowwide) НЕ падает: открывается с описанием, шагами и ошибками */
        await page.locator('#techList .excard[data-a="horizrowwide"]').click();
        await expect(page.locator('.card .exhead .ico')).toHaveCount(1, { timeout: 5000 });
        await expect(page.locator('.card .exphotos')).toHaveCount(0);
        await expect(page.locator('.card .exdesc')).toContainText('верх спины и трапеции');
        await expect(page.locator('.card .techstep')).toHaveCount(3);
        await expect(page.locator('.card .techerr', { hasText: 'Не раскачивайся корпусом' })).toHaveCount(1);
        await page.locator('[data-act="techBack"]').click();
        /* деталь вариации с фото (latpullneutral): 2 ракурса из новых файлов + RU-описание */
        await expect(page.locator('#techList .excard[data-a="latpullneutral"]')).toBeVisible({ timeout: 5000 });
        await page.locator('#techList .excard[data-a="latpullneutral"]').click();
        const photos = page.locator('.card .exphotos img');
        await expect(photos).toHaveCount(2, { timeout: 5000 });
        await expect(photos.nth(0)).toHaveAttribute('src', /latpullneutral-0\.jpg$/);
        await expect(photos.nth(1)).toHaveAttribute('src', /latpullneutral-1\.jpg$/);
        await expect.poll(async () => photos.nth(0).evaluate(function (el) { return el.naturalWidth; }), { timeout: 5000 }).toBeGreaterThan(0);
        await expect(page.locator('.card .exdesc')).toContainText('тянуть глубже');
    });

});

/* ===== [ONB-T3..T7] онбординг: приветствие, туториал, Помощь, «Что нового», контакты ===== */

/* вторая порция init-скриптов выполняется ПОСЛЕ общей: сброс флагов = чистый localStorage.
   Гасим повторный сброс через sessionStorage — иначе он сработал бы и на reload,
   и тест «пропуск навсегда» после перезагрузки снова увидел бы чистые флаги */
async function cleanOnb(page) {
    await page.addInitScript(function () {
        try {
            if (sessionStorage.getItem('__onbCleaned')) return;
            sessionStorage.setItem('__onbCleaned', '1');
            localStorage.clear();
        } catch (e) { /* noop */ }
    });
}
/* элемент под щитом туториала? (elementFromPoint в центре элемента) */
function coveredByShield(page, selector) {
    return page.evaluate(function (sel) {
        const el = document.querySelector(sel);
        if (!el) return 'нет элемента: ' + sel;
        const r = el.getBoundingClientRect();
        const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return t && t.closest && t.closest('.spot-shield') ? 'shield' : 'доступен';
    }, selector);
}

test.describe('[ONB-T3] приветствие', function () {
    test('чистый localStorage: карусель показывается, слайды и точки, «Пропустить» навсегда', async ({ page }) => {
        await cleanOnb(page);
        await page.goto('/');
        await expect(page.locator('.obwrap')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('.wtitle')).toHaveText('GymHelper');
        await expect(page.locator('.wtag')).toContainText('Дневник тренировок в Telegram');
        await expect(page.locator('.car-card')).toHaveCount(3);
        await expect(page.locator('.dots i')).toHaveCount(3);
        await expect(page.locator('[data-act="obNext"]')).toHaveText('Далее');
        await expect(page.locator('.wskip')).toBeVisible();
        /* слайд 1 активен */
        let onIdx = await page.evaluate(function () {
            return Array.prototype.indexOf.call(document.querySelectorAll('.dots i'), document.querySelector('.dots i.on'));
        });
        if (onIdx !== 0) throw new Error('активная точка слайда 1: ' + onIdx);
        /* «Далее» ×2 → финальный слайд: кнопка «Начать», «Пропустить» убрана */
        await page.locator('[data-act="obNext"]').click();
        onIdx = await page.evaluate(function () {
            return Array.prototype.indexOf.call(document.querySelectorAll('.dots i'), document.querySelector('.dots i.on'));
        });
        if (onIdx !== 1) throw new Error('активная точка слайда 2: ' + onIdx);
        await page.locator('[data-act="obNext"]').click();
        await expect(page.locator('[data-act="obNext"]')).toHaveText('Начать');
        await expect(page.locator('.wskip')).toHaveCount(0);
        onIdx = await page.evaluate(function () {
            return Array.prototype.indexOf.call(document.querySelectorAll('.dots i'), document.querySelector('.dots i.on'));
        });
        if (onIdx !== 2) throw new Error('активная точка слайда 3: ' + onIdx);
        /* «Начать» → автопоказ туториала; «Пропустить» туториала → приложение */
        await page.locator('[data-act="obNext"]').click();
        await expect(page.locator('#tutTip')).toBeVisible({ timeout: 5000 });
        await page.locator('[data-act="tutSkip"]').click();
        await expect(page.locator('#app .hero, #app .pcard').first()).toBeVisible({ timeout: 5000 });
        const done = await page.evaluate(function () { try { return localStorage.getItem('gymOnbDone'); } catch (e) { return null; } });
        if (done !== '1') throw new Error('gymOnbDone не установлен: ' + done);
        /* перезагрузка: приветствие больше не показывается */
        await page.reload();
        await expect(page.locator('#app .hero, #app .pcard').first()).toBeVisible({ timeout: 10000 });
        await expect(page.locator('.obwrap')).toHaveCount(0);
    });

    test('«Пропустить» на слайде 1: тоже навсегда (перезагрузка не показывает)', async ({ page }) => {
        await cleanOnb(page);
        await page.goto('/');
        await expect(page.locator('.obwrap')).toBeVisible({ timeout: 10000 });
        await page.locator('.wskip').click();
        /* после приветствия — туториал; пропускаем и его */
        await expect(page.locator('#tutTip')).toBeVisible({ timeout: 5000 });
        await page.locator('[data-act="tutSkip"]').click();
        await expect(page.locator('#app .hero, #app .pcard').first()).toBeVisible({ timeout: 5000 });
        await page.reload();
        await expect(page.locator('.obwrap')).toHaveCount(0);
        await expect(page.locator('#tutTip')).toHaveCount(0);
    });
});

test.describe('[ONB-T4] туториал', function () {
    test('шаги 1/3/4 поверх реальных экранов; элементы под подсказкой некликабельны; шаг 2 пропущен без активной', async ({ page }) => {
        await cleanOnb(page);
        await page.goto('/');
        await page.locator('.wskip').click();
        await expect(page.locator('#tutTip .step')).toHaveText('Шаг 1 из 4 · Новая тренировка', { timeout: 5000 });
        /* подсветка вложена в FAB */
        await expect(page.locator('.nav .nfab .spot.wrap.round')).toHaveCount(1);
        /* тултип не перекрывает FAB (виден весь) */
        expect(await coveredByShield(page, '.nav .nfab')).toBe('shield');
        /* «Дальше» → шаг 2 пропускается (нет активной тренировки) → шаг 3 на Истории */
        await page.locator('[data-act="tutNext"]').click();
        await expect(page.locator('#tutTip .step')).toHaveText('Шаг 3 из 4 · Календарь и настройки', { timeout: 5000 });
        await expect(page.locator('.tbpair .spot.wrap.pair')).toHaveCount(1);
        await expect(page.locator('.tb-title')).toContainText('История');
        expect(await coveredByShield(page, '[aria-label="Настройки"]')).toBe('shield');
        /* «Дальше» → шаг 4: подложка — вкладка Статистика, подсветка на табе */
        await page.locator('[data-act="tutNext"]').click();
        await expect(page.locator('#tutTip .step')).toHaveText('Шаг 4 из 4 · Прогресс', { timeout: 5000 });
        await expect(page.locator('.tb-title')).toContainText('Статистика');
        await expect(page.locator('.nav .nbtn .spot.wrap.tab')).toHaveCount(1);
        /* «Дальше» на последнем шаге завершает молча */
        await page.locator('[data-act="tutNext"]').click();
        await expect(page.locator('#tutTip')).toHaveCount(0);
        await expect(page.locator('.spot-shield')).toHaveCount(0);
        const done = await page.evaluate(function () { try { return localStorage.getItem('gymOnbDone'); } catch (e) { return null; } });
        if (done !== '1') throw new Error('gymOnbDone не установлен после туториала');
    });

    test('шаг 2: спотлайт на реальной пилюле добавления подхода (.ex-addset), тап заблокирован', async ({ page, request }) => {
        const today = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            profile: { sex: 'м', age: 30, height: 180, weight: 90 },
            workouts: [{ id: 1, date: today, started: today + 'T18:00:00', ended: '', finished: false, title: '', nutrition: '',
                exercises: [{ name: EX, st: today + 'T18:01:00', en: '', sets: [{ w: '100', s: 3, r: '8-10', t: today + 'T18:02:00' }] }] }]
        } } });
        await cleanOnb(page);
        await page.goto('/');
        await page.locator('.wskip').click();
        await page.locator('[data-act="tutNext"]').click();
        await expect(page.locator('#tutTip .step')).toHaveText('Шаг 2 из 4 · Подходы', { timeout: 5000 });
        /* подложка — реальная карточка активной тренировки; подсветка ВЛОЖЕНА в пилюлю .ex-addset */
        await expect(page.locator('.expill .ex-addset .spot.wrap.box')).toHaveCount(1);
        expect(await coveredByShield(page, '.expill .ex-addset')).toBe('shield');
        /* «Дальше» → шаг 3 (История, пара в шапке) */
        await page.locator('[data-act="tutNext"]').click();
        await expect(page.locator('#tutTip .step')).toHaveText('Шаг 3 из 4 · Календарь и настройки', { timeout: 5000 });
        /* «Пропустить» в середине — тоже завершает */
        await page.locator('[data-act="tutSkip"]').click();
        await expect(page.locator('#tutTip')).toHaveCount(0);
    });
});

/* ===== [ANA-T5] онбординг-события: клиент шлёт /api/track, мок собирает (/api/track-events) ===== */

/* список собранных моком событий (после /api/reset он пуст) */
async function trackedEvents(request) {
    const r = await request.get('/api/track-events');
    return await r.json();
}

test.describe('[ANA-T5] онбординг-события (/api/track)', function () {
    test('полное прохождение: onboardingStarted + onboardingCompleted по 1 разу, перезагрузка без дублей', async ({ page, request }) => {
        await cleanOnb(page);
        await page.goto('/');
        await expect(page.locator('.obwrap')).toBeVisible({ timeout: 10000 });
        /* started уходит сразу при открытии приветствия */
        await expect.poll(async () => (await trackedEvents(request)).join(',')).toContain('onboardingStarted');
        /* приветствие до конца: «Далее» ×2 → «Начать» → туториал автопоказом */
        await page.locator('[data-act="obNext"]').click();
        await page.locator('[data-act="obNext"]').click();
        await page.locator('[data-act="obNext"]').click();
        await expect(page.locator('#tutTip')).toBeVisible({ timeout: 5000 });
        /* туториал до конца: шаг 1 → (шаг 2 пропущен, нет активной) → шаг 3 → шаг 4 → финал */
        await page.locator('[data-act="tutNext"]').click();
        await page.locator('[data-act="tutNext"]').click();
        await page.locator('[data-act="tutNext"]').click();
        await expect(page.locator('#tutTip')).toHaveCount(0);
        await expect.poll(async () => (await trackedEvents(request)).join(',')).toContain('onboardingCompleted');
        /* перезагрузка: онбординг пройден — новых событий нет (дедуп в localStorage) */
        await page.reload();
        await expect(page.locator('#app .hero, #app .pcard').first()).toBeVisible({ timeout: 10000 });
        const events = await trackedEvents(request);
        const count = function (name) { return events.filter(function (e) { return e === name; }).length; };
        if (count('onboardingStarted') !== 1) throw new Error('onboardingStarted не ровно 1: ' + JSON.stringify(events));
        if (count('onboardingCompleted') !== 1) throw new Error('onboardingCompleted не ровно 1: ' + JSON.stringify(events));
        if (count('onboardingTutorialSkipped') !== 0) throw new Error('onboardingTutorialSkipped лишний: ' + JSON.stringify(events));
    });

    test('пропуск туториала: onboardingStarted + onboardingTutorialSkipped, completed не уходит', async ({ page, request }) => {
        await cleanOnb(page);
        await page.goto('/');
        await expect(page.locator('.obwrap')).toBeVisible({ timeout: 10000 });
        await page.locator('.wskip').click();
        await expect(page.locator('#tutTip')).toBeVisible({ timeout: 5000 });
        await page.locator('[data-act="tutSkip"]').click();
        await expect(page.locator('#tutTip')).toHaveCount(0);
        await expect.poll(async () => (await trackedEvents(request)).join(',')).toContain('onboardingTutorialSkipped');
        const events = await trackedEvents(request);
        if (events.indexOf('onboardingCompleted') >= 0) throw new Error('completed не должен был уйти: ' + JSON.stringify(events));
        const started = events.filter(function (e) { return e === 'onboardingStarted'; }).length;
        if (started !== 1) throw new Error('onboardingStarted не ровно 1: ' + JSON.stringify(events));
    });
});

test.describe('[ONB-T5] Помощь (FAQ)', function () {
    test('вход из Настроек → «О приложении», 7 вопросов, аккордеон, пилюля «новое» до первого открытия', async ({ page }) => {
        await page.addInitScript(function () { try { localStorage.removeItem('gymHelpSeen'); } catch (e) { /* noop */ } });
        await openApp(page);
        await page.locator('[aria-label="Настройки"]').click();
        const row = page.locator('#app button', { hasText: 'Помощь и FAQ' });
        await expect(row).toBeVisible();
        await expect(row.locator('.newpill')).toHaveText('новое');
        await row.click();
        await expect(page.locator('.tb-title')).toContainText('Помощь', { timeout: 5000 });
        await expect(page.locator('.faq-it')).toHaveCount(7);
        /* вопроса про тему нет (решение владельца) */
        await expect(page.locator('.faq-q', { hasText: 'тему' })).toHaveCount(0);
        /* аккордеон: открыт один вопрос; «Как считаются калории?» — MET */
        await page.locator('.faq-q', { hasText: 'Как считаются калории?' }).click();
        await expect(page.locator('.faq-it.open')).toHaveCount(1);
        await expect(page.locator('.faq-a')).toContainText('формуле MET');
        await page.locator('.faq-q', { hasText: 'Что такое 1ПМ?' }).click();
        await expect(page.locator('.faq-it.open', { hasText: 'Что такое 1ПМ?' })).toHaveCount(1);
        await expect(page.locator('.faq-a')).toHaveCount(1);
        /* «Повторить подсказки» запускает туториал; пропуск возвращает в приложение */
        await page.locator('#app button', { hasText: 'Повторить подсказки' }).click();
        await expect(page.locator('#tutTip')).toBeVisible({ timeout: 5000 });
        await page.locator('[data-act="tutSkip"]').click();
        await expect(page.locator('#tutTip')).toHaveCount(0);
        /* повторный вход в Помощь: пилюля «новое» исчезла; «←» — назад в Настройки */
        await page.locator('[aria-label="Настройки"]').click();
        await page.locator('#app button', { hasText: 'Помощь и FAQ' }).click();
        await expect(page.locator('.tb-title')).toContainText('Помощь', { timeout: 5000 });
        await page.locator('[aria-label="Назад"]').click();
        await expect(page.locator('.tb-title')).toContainText('Настройки', { timeout: 5000 });
        /* [ONB-S6] пилюля импорта на карточке «Данные» не считается — здесь проверяем
           только погасшую пилюлю Помощи (карточка импорта появилась позже этого теста) */
        await expect(page.locator('.card:not(.impdata) .newpill')).toHaveCount(0);
    });
});

test.describe('[ONB-T6] контакты и проверка сервера', function () {
    test('deep-link на бота (?start=feedback), копирование email, /health ok и fail', async ({ page }) => {
        await openApp(page);
        await page.locator('[aria-label="Настройки"]').click();
        await page.locator('#app button', { hasText: 'Помощь и FAQ' }).click();
        await expect(page.locator('.wn-foot')).toContainText('GymHelper 1.43');
        /* deep-link: вне Telegram tg.openLink — подменяем и ловим URL (fallback window.open тоже) */
        await page.evaluate(function () {
            window.__openUrls = [];
            if (window.Telegram && window.Telegram.WebApp) {
                window.Telegram.WebApp.openLink = function (u) { window.__openUrls.push(String(u)); };
            }
            window.open = function (u) { window.__openUrls.push(String(u)); return null; };
        });
        await page.locator('.cbtn', { hasText: 'Написать разработчику' }).click();
        const urls = await page.evaluate(function () { return window.__openUrls; });
        if (!urls.length || urls[0] !== 'https://t.me/GymHelper_bot?start=feedback') {
            throw new Error('deep-link неверен: ' + JSON.stringify(urls));
        }
        /* email: буфер обмена + тост подтверждения */
        await page.locator('.cbtn', { hasText: 'Скопировать email' }).click();
        await expect(page.locator('.toast.show')).toHaveText('Скопировано', { timeout: 5000 });
        await expect(page.locator('.cbtn', { hasText: 'Скопировать email' })).toContainText('support.gymhelper@gmail.com');
        /* сервер: мок /health тестового сервера отвечает ok:true */
        await page.locator('#app button', { hasText: 'Проверить сервер' }).click();
        await expect(page.locator('.serline.ok')).toHaveText('✅ Сервер работает', { timeout: 5000 });
        /* /health недоступен → «⛔ Сервер не отвечает» (повторный тап — перепроверка) */
        await page.route('**/health', function (route) { route.abort(); });
        await page.locator('#app button', { hasText: 'Проверить сервер' }).click();
        await expect(page.locator('.serline.fail')).toHaveText('⛔ Сервер не отвечает', { timeout: 5000 });
    });
});

test.describe('[ONB-T7] «Что нового»', function () {
    /* подкладывает фейковый релиз в RELNOTES (const-ссылка мутируема) и снимает флаги */
    async function fakeRelease(page) {
        await page.evaluate(function () {
            window.__gym.RELNOTES.push({ ver: '9.99', items: [
                { t: 'Тестовая фича', d: 'Описание для e2e-теста' },
                { t: 'Вторая фича', d: 'Ещё пункт' }
            ] });
            try { localStorage.removeItem('gymWnOff'); localStorage.removeItem('gymWnVer'); } catch (e) { /* noop */ }
            window.__gym.wnAuto();
            window.__gym.render();
        });
    }

    test('пустой RELNOTES — выключатель: автопоказа нет; ручная строка даёт тост', async ({ page }) => {
        await openApp(page);
        /* изоляция: дефолтный RELNOTES содержит запись актуального релиза — для проверки
           «пустого» поведения очищаем массив вручную и перерисовываем */
        await page.evaluate(function () {
            window.__gym.RELNOTES.length = 0;
            window.__gym.wnAuto();
            window.__gym.render();
        });
        await expect(page.locator('.mwrap')).toHaveCount(0);
        await page.locator('[aria-label="Настройки"]').click();
        await page.locator('#app button', { hasText: 'Что нового' }).click();
        await expect(page.locator('.toast.show')).toHaveText('Новых возможностей пока нет', { timeout: 5000 });
        await expect(page.locator('.mwrap')).toHaveCount(0);
    });

    test('автопоказ значимого релиза; «Понятно» — раз на релиз; тап по фону закрывает', async ({ page }) => {
        await openApp(page);
        await fakeRelease(page);
        await expect(page.locator('.mwrap .wnm')).toBeVisible();
        await expect(page.locator('.relpill')).toHaveText('Релиз 9.99');
        await expect(page.locator('.wni')).toHaveCount(2);
        await expect(page.locator('.wni b').first()).toHaveText('Тестовая фича');
        /* «Понятно» → закрыта, gymWnVer записан, повторный автопоказ молчит */
        await page.locator('[data-act="wnAck"]').click();
        await expect(page.locator('.mwrap')).toHaveCount(0);
        const ver = await page.evaluate(function () { try { return localStorage.getItem('gymWnVer'); } catch (e) { return null; } });
        if (ver !== '9.99') throw new Error('gymWnVer не записан: ' + ver);
        await page.evaluate(function () { window.__gym.wnAuto(); window.__gym.render(); });
        await expect(page.locator('.mwrap')).toHaveCount(0);
        /* сброс и повтор: тап по фону тоже закрывает (и пишет флаг) */
        await page.evaluate(function () {
            try { localStorage.removeItem('gymWnVer'); } catch (e) { /* noop */ }
            window.__gym.wnAuto();
            window.__gym.render();
        });
        await expect(page.locator('.mwrap .wnm')).toBeVisible();
        await page.locator('.mwrap').click({ position: { x: 8, y: 8 } });
        await expect(page.locator('.mwrap')).toHaveCount(0);
        const ver2 = await page.evaluate(function () { try { return localStorage.getItem('gymWnVer'); } catch (e) { return null; } });
        if (ver2 !== '9.99') throw new Error('тап по фону не записал gymWnVer: ' + ver2);
    });

    test('«Больше не показывать» глушит автопоказ; ручная строка работает; тогл синхронен gymWnOff', async ({ page }) => {
        await openApp(page);
        await fakeRelease(page);
        await expect(page.locator('.mwrap .wnm')).toBeVisible();
        await page.locator('[data-act="wnOff"]').click();
        await expect(page.locator('.mwrap')).toHaveCount(0);
        const off = await page.evaluate(function () { try { return localStorage.getItem('gymWnOff'); } catch (e) { return null; } });
        if (off !== '1') throw new Error('gymWnOff не установлен: ' + off);
        /* автопоказ заглушен даже без gymWnVer */
        await page.evaluate(function () {
            try { localStorage.removeItem('gymWnVer'); } catch (e) { /* noop */ }
            window.__gym.wnAuto();
            window.__gym.render();
        });
        await expect(page.locator('.mwrap')).toHaveCount(0);
        /* ручная строка продолжает работать при заглушенном автопоказе */
        await page.locator('[aria-label="Настройки"]').click();
        await page.locator('#app button', { hasText: 'Что нового' }).click();
        await expect(page.locator('.mwrap .wnm')).toBeVisible();
        await page.locator('[data-act="wnAck"]').click();
        await expect(page.locator('.mwrap')).toHaveCount(0);
        /* тогл «Сообщать об обновлениях»: выключен (gymWnOff=1) → клик включает → клик выключает */
        const sw = page.locator('[role="switch"][aria-label="Сообщать об обновлениях"]');
        await expect(sw).toHaveAttribute('aria-checked', 'false');
        await sw.click();
        await expect(sw).toHaveAttribute('aria-checked', 'true');
        const off2 = await page.evaluate(function () { try { return localStorage.getItem('gymWnOff'); } catch (e) { return null; } });
        if (off2 === '1') throw new Error('включение тогла не сняло gymWnOff');
        await sw.click();
        await expect(sw).toHaveAttribute('aria-checked', 'false');
        const off3 = await page.evaluate(function () { try { return localStorage.getItem('gymWnOff'); } catch (e) { return null; } });
        if (off3 !== '1') throw new Error('выключение тогла не установило gymWnOff');
    });

    /* [РЕЛИЗ 1.43] автопоказ РЕАЛЬНОГО релиза: пользователь, видевший 1.42 (gymWnVer=1.42),
       при открытии обновлённого приложения получает модалку «Релиз 1.43» с тремя пунктами
       (заметки / карта мышц / импорт Strong); «Понятно» пишет gymWnVer=1.43, перезагрузка
       автопоказ не возвращает (механизм выше гоняется на фейковом 9.99, контент текущего
       релиза здесь; gymWnOff глобального хука снят, тест именно про автопоказ) */
    test('реальный релиз 1.43: автопоказ пользователю 1.42 — «Релиз 1.43», 3 пункта, флаг раз-на-релиз', async ({ page }) => {
        /* глобальный beforeEach-хук ставит gymWnOff=1 (глушит автопоказ всем тестам);
           init-скрипт снимает его и сажает «пользователя 1.42»; self-guard: после
           перезагрузки скрипт больше ничего не меняет (флаг установки уже стоит) */
        await page.addInitScript(function () {
            try {
                if (localStorage.getItem('gymRel143Set') === '1') return;
                localStorage.setItem('gymRel143Set', '1');
                localStorage.removeItem('gymWnOff');
                localStorage.setItem('gymWnVer', '1.42');
            } catch (e) { /* noop */ }
        });
        await openApp(page);
        /* первый вход после обновления: wnAuto открыл модалку 1.43 поверх приложения */
        await expect(page.locator('.mwrap .wnm')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.relpill')).toHaveText('Релиз 1.43');
        await expect(page.locator('.wni')).toHaveCount(3);
        await expect(page.locator('.wni b')).toContainText(['Заметка к тренировке', 'Карта мышц', 'Импорт из Strong']);
        /* «Понятно» пишет флаг реального релиза; перезагрузка автопоказ не возвращает */
        await page.locator('[data-act="wnAck"]').click();
        await expect(page.locator('.mwrap')).toHaveCount(0);
        const ver = await page.evaluate(function () { try { return localStorage.getItem('gymWnVer'); } catch (e) { return null; } });
        if (ver !== '1.43') throw new Error('gymWnVer после «Понятно»: ' + ver);
        await page.reload();
        await expect(page.locator('#app .hero, #app .pcard').first()).toBeVisible({ timeout: 10000 });
        await expect(page.locator('.mwrap')).toHaveCount(0);
    });
});

/* ============ [GOA-S1] цели тренировок (docs/spec-goa-s1-goals.md) ============ */
test.describe('GOA-S1 цели', function () {
    const EXG = 'Жим штанги лёжа';

    /* силовая цель через мастер: упражнение из истории → значение → срок квартал */
    async function createStrengthGoalUi(page, target) {
        await page.locator('[data-act="switchTab"][data-a="stats"]').click();
        await page.locator('[data-act="openGoals"]').click();
        await page.locator('[data-act="goalNew"]').click();
        await page.locator('[data-act="gwType"][data-a="1"]').click();
        await page.locator('#gwList .frow', { hasText: EXG }).first().click();
        await page.locator('#gwTarget').fill(String(target));
        await page.locator('[data-act="gwTargetNext"]').click();
        await page.locator('[data-act="gwPeriod"][data-a="quarter"]').click();
        await page.locator('[data-act="gwCreate"]').click();
        await expect(page.locator('.gcard', { hasText: EXG })).toBeVisible();
    }
    /* частотная цель: значение → срок неделя */
    async function createFreqGoalUi(page, target) {
        await page.locator('[data-act="switchTab"][data-a="stats"]').click();
        await page.locator('[data-act="openGoals"]').click();
        await page.locator('[data-act="goalNew"]').click();
        await page.locator('[data-act="gwType"][data-a="2"]').click();
        await page.locator('#gwTarget').fill(String(target));
        await page.locator('[data-act="gwTargetNext"]').click();
        await page.locator('[data-act="gwPeriod"][data-a="week"]').click();
        await page.locator('[data-act="gwCreate"]').click();
        /* карточка цели на экране «Цели» (мастер закрылся, создание сохранено) */
        await page.waitForSelector('.gcard', { state: 'visible', timeout: 8000 });
    }
    /* повтор прошлой тренировки + новый подход (сначала закрываем подэкран «Цели» —
       тап по табу, иначе подэкран перебивает карточку тренировки) */
    async function recordSet(page, weight, reps) {
        await page.locator('[data-act="switchTab"][data-a="history"]').click();
        await page.locator('.nav .nfab').click();
        await page.locator('.modal.open [data-act="newRepeat"]').click();
        /* пилюля добавления подхода: «.ex-addset» после merge UX-I15 (main), «.ex-add» на
           этой ветке (UX-I15 не смержена) — универсальный селектор для обеих версий */
        await page.locator('.ex-addset, .ex-add').click();
        await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 });
        await page.locator('#mWeight').fill(weight);
        await page.locator('#mReps').fill(reps);
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
    }

    test('силовая цель: переживает reload и save, достижение — тост цели вместо PR-тоста, архив', async function ({ page, request }) {
        test.setTimeout(60000);
        const day = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: { rev: 1, nextId: 2, workouts: [doneWorkout(1, day, EXG, '100', 1)] } } });
        await openApp(page);
        await createStrengthGoalUi(page, '140');
        /* переживает reload: серверный протокол «ex» нормализуется на границе — цель не «зомби» */
        await page.reload();
        await openApp(page);
        await page.locator('[data-act="switchTab"][data-a="stats"]').click();
        await expect(page.locator('.goalsw .wrow', { hasText: EXG })).toBeVisible();
        /* переживает save: при отправке exercise→ex, merge сервера цель не теряет */
        await recordSet(page, '110', '9'); /* e1RM 143 ≥ 140: PR и цель одновременно */
        const st = await request.get('/api/state');
        const state = await st.json();
        expect(state.goals.length).toBe(1);
        expect(state.goals[0].ex).toBe(EXG);
        /* тост ТОЛЬКО цели (§11) — PR-тост подавлен */
        await expect(page.locator('#toast')).toHaveText(/Цель достигнута/);
        const toastText = await page.locator('#toast').textContent();
        expect(toastText).not.toContain('Новый рекорд');
        /* после reload цель в архиве: строка из doneDate/doneValue, без пересчётов */
        await page.reload();
        await openApp(page);
        await page.locator('[data-act="switchTab"][data-a="stats"]').click();
        await page.locator('[data-act="openGoals"]').click();
        await expect(page.locator('#app')).toContainText('Активные · 0 из 5');
        const row = page.locator('.garow', { hasText: EXG });
        await expect(row).toBeVisible();
        await expect(row).toContainText('e1RM 143');
    });

    test('частотная цель закрывается при завершении тренировки; без горизонтального скролла', async function ({ page, request }) {
        test.setTimeout(60000);
        const day = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: { rev: 1, nextId: 2, workouts: [doneWorkout(1, day, EXG, '100', 1)] } } });
        await openApp(page);
        await createFreqGoalUi(page, '1');
        await recordSet(page, '80', '10');
        await page.locator('[data-act="finishWorkout"]').click();
        await expect(page.locator('#toast')).toHaveText(/Цель достигнута! 1 тренировка/);
        /* экраны без горизонтального скролла (реальная проверка — проект android360) */
        const sw = await page.evaluate(function () { return document.documentElement.scrollWidth; });
        expect(sw).toBeLessThanOrEqual(page.viewportSize().width + 1);
        await page.locator('[data-act="switchTab"][data-a="stats"]').click();
        await page.locator('[data-act="openGoals"]').click();
        await expect(page.locator('.garow', { hasText: 'выполнено 2 из 1' })).toBeVisible(); /* seed-тренировка тоже в окне недели */
    });

    test('лимит активных целей: 5 создаются, 6-я — плашка и disabled-карточки', async function ({ page, request }) {
        test.setTimeout(60000);
        const day = isoDate(new Date());
        const goals = [];
        for (let i = 0; i < 4; i++) {
            goals.push({ id: i + 2, type: 2, target: 8 + i, start: day, end: '2030-01-07', status: 1, doneDate: '', doneValue: 0 });
        }
        await request.post('/api/save', { data: { initData: '', rev: 1, data: { rev: 1, nextId: 6, workouts: [doneWorkout(1, day, EXG, '100', 1)], goals: goals } } });
        await openApp(page);
        /* 5-я — через UI (мастер работает при 4 активных) */
        await page.locator('[data-act="switchTab"][data-a="stats"]').click();
        await page.locator('[data-act="openGoals"]').click();
        await createFreqGoalUi(page, 12);
        await expect(page.locator('#app')).toContainText('Активные · 5 из 5');
        /* 6-я: мастер открывается, но шаг 1 — плашка и disabled-карточки (§8.4) */
        await page.locator('[data-act="goalNew"]').click();
        await expect(page.locator('.gwlimit')).toContainText('отмените одну');
        await expect(page.locator('.frow.off').first()).toBeVisible();
    });

    test('архив: ✕ удаляет без подтверждения, «Повторить» открывает мастер с предзаполнением', async function ({ page, request }) {
        test.setTimeout(60000);
        const day = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: { rev: 1, nextId: 2, workouts: [doneWorkout(1, day, EXG, '100', 1)] } } });
        await openApp(page);
        await createStrengthGoalUi(page, '135'); /* > e1RM 130 — без предупреждения §4.3 */
        await recordSet(page, '110', '9'); /* 143 ≥ 135 → в архив */
        await page.locator('[data-act="switchTab"][data-a="stats"]').click();
        await page.locator('[data-act="openGoals"]').click();
        const row = page.locator('.garow', { hasText: EXG });
        await expect(row).toBeVisible();
        /* «Повторить» — мастер сразу на шаге срока с предзаполнением (§8.3) */
        await row.locator('[data-act="goalRepeat"]').click();
        await expect(page.locator('.stepcap')).toHaveText('Шаг 4 из 4 · Срок');
        await page.locator('[data-act="gwCancel"]').click();
        await expect(page.locator('.garow', { hasText: EXG })).toBeVisible();
        /* ✕ — удаление из архива безвозвратно и без confirm (§4.3) */
        await page.locator('.garow', { hasText: EXG }).locator('.gdel').click();
        await expect(page.locator('.modal.open')).not.toBeVisible();
        await expect(page.locator('.garow', { hasText: EXG })).toHaveCount(0);
    });
});

/* ============ [UX-I16] шейринг тренировки по ссылке ============ */
test.describe('[UX-I16] шейринг по ссылке', function () {

    test('шит «Телеграм» → буфер → выбор чата → тост; повтор даёт ту же ссылку', async ({ page, context, request }) => {
        test.setTimeout(60000);
        /* мок Telegram WebApp: telegram-web-app.js (загружается из index.html) ЗАМЕНЯЕТ
           window.Telegram.WebApp после init-скриптов — переустанавливаем openTelegramLink
           на том же объекте интервалом, пока app.js не снимет копию (tg = const) */
        await context.addInitScript(function () {
            let tries = 0;
            const t = setInterval(function () {
                tries++;
                const w = window.Telegram || (window.Telegram = {});
                const app = w.WebApp;
                if (app && !app.__mocked) {
                    app.__mocked = true;
                    app.__opened = [];
                    app.openTelegramLink = function (url) { app.__opened.push(url); };
                }
                /* окно 10с (было 1с = 40×25мс): на медленном CI telegram-web-app.js может
                   исполниться позже первой секунды от document-start — мок не успевал
                   установиться, и приложение звало vendor downloadFile (флейк UX-I14) */
                if ((app && app.__mocked) || tries > 400) clearInterval(t);
            }, 25);
        });
        /* буфер: in-memory мок navigator.clipboard вместо grantPermissions — clipboard-*
           permissions Playwright поддерживает только в Chromium, на WebKit падает
           (BLOCKED-вердикт tester). UX-поток не меняется: app вызывает
           navigator.clipboard.writeText → мок копит значения, readText отдаёт последнее */
        await context.addInitScript(function () {
            const mem = [];
            try {
                Object.defineProperty(navigator, 'clipboard', {
                    configurable: true,
                    value: {
                        writeText: function (t) { mem.push(String(t)); return Promise.resolve(); },
                        readText: function () { return Promise.resolve(mem.length ? mem[mem.length - 1] : ''); }
                    }
                });
            } catch (e) { /* движок не дал переопределить — тест упадёт по тосту, сигнал тот же */ }
        });
        const today = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [], profile: { sex: 'м', age: 30, height: 180, weight: 90 },
            workouts: [doneWorkout(1, today, EX, '120', 3)]
        } } });
        await openApp(page);
        /* у активной/пустой тренировки кнопки нет; у завершённой — в теле карточки */
        await page.locator('.pcard').first().click();
        const shareBtn = page.locator('[data-act="shareSheet"]');
        await expect(shareBtn).toBeVisible({ timeout: 5000 });
        await shareBtn.click();
        const modal = page.locator('.modal.open');
        await expect(modal).toBeVisible({ timeout: 5000 });
        /* [UX-S16] «Картинка» вернулась: в шите два пункта, бейдж «выбор» на кнопке,
           тогл имени и футер на месте */
        await expect(modal.locator('.shrow')).toHaveCount(2);
        await expect(modal.locator('.shrow.tg')).toBeEnabled();
        await expect(modal.locator('.shrow', { hasText: 'Картинка' })).toHaveCount(1);
        await expect(shareBtn.locator('.tag')).toHaveText('выбор');
        /* тап «Телеграм»: шит закрывается → prepare ссылки → буфер → выбор чата
           (на localhost prepare мгновенный, busy-состояние кнопки не ловим ассертом) */
        await modal.locator('.shrow.tg').click();
        await expect(modal).not.toBeVisible({ timeout: 5000 });
        await expect(page.locator('.toast.show')).toContainText('Ссылка скопирована', { timeout: 5000 });
        const url = await page.evaluate(function () { return navigator.clipboard.readText(); });
        expect(url).toMatch(/\/w\/[0-9a-zA-Z]{22}$/);
        const opened = await page.evaluate(function () { return window.Telegram.WebApp.__opened; });
        expect(opened.length).toBe(1);
        expect(opened[0]).toBe('https://t.me/share/url?url=' + encodeURIComponent(url));
        /* клиентские счётчики воронки доезжают через /api/track */
        const ev = await (await request.get('/api/track-events')).json();
        expect(ev).toContain('linkCopy');
        expect(ev).toContain('linkSend');
        /* после возврата из выбора чата кнопка разблокирована */
        await expect(shareBtn).toBeEnabled();
        /* повторный шеринг той же тренировки — тот же shareId (§4.2) */
        await shareBtn.click();
        await page.locator('.modal.open .shrow.tg').click();
        await expect(page.locator('.toast.show')).toContainText('Ссылка скопирована', { timeout: 5000 });
        const url2 = await page.evaluate(function () { return navigator.clipboard.readText(); });
        expect(url2).toBe(url);
    });

    test('[UX-S16] «Картинка»: POST /api/card → тост «постер в чате с ботом», воронка cardClick/cardOk', async ({ page, request }) => {
        test.setTimeout(60000);
        const today = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [], profile: { sex: 'м', age: 30, height: 180, weight: 90 },
            workouts: [doneWorkout(1, today, EX, '120', 3)]
        } } });
        await openApp(page);
        await page.locator('.pcard').first().click();
        const shareBtn = page.locator('[data-act="shareSheet"]');
        await expect(shareBtn).toBeVisible({ timeout: 5000 });
        await shareBtn.click();
        const modal = page.locator('.modal.open');
        await expect(modal).toBeVisible({ timeout: 5000 });
        /* тап «Картинка»: шит закрывается → сервер готовит постер и шлёт ботом → тост;
           Mini App никуда не навигирует (урок UX-B15) */
        await modal.locator('.shrow', { hasText: 'Картинка' }).click();
        await expect(modal).not.toBeVisible({ timeout: 5000 });
        await expect(page.locator('.toast.show')).toContainText('Постер отправлен в чат с ботом', { timeout: 5000 });
        /* кнопка разблокирована, бейдж «выбор» на месте */
        await expect(shareBtn).toBeEnabled();
        await expect(shareBtn.locator('.tag')).toHaveText('выбор');
        /* клиентская воронка: cardClick на тап пункта, cardOk по ответу; ошибки нет */
        const ev = await (await request.get('/api/track-events')).json();
        expect(ev).toContain('cardClick');
        expect(ev).toContain('cardOk');
        expect(ev).not.toContain('cardErr');
    });

    test('[UX-S16] «Картинка»: сервер вернул ошибку (лимит) — тост с текстом сервера, cardErr в воронке', async ({ page, request }) => {
        test.setTimeout(60000);
        /* cardfail-режим мока: /api/card отвечает 429 с человекочитаемой ошибкой */
        await request.post('/api/reset?cardfail=1');
        const today = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [], profile: { sex: 'м', age: 30, height: 180, weight: 90 },
            workouts: [doneWorkout(1, today, EX, '120', 3)]
        } } });
        await openApp(page);
        await page.locator('.pcard').first().click();
        await page.locator('[data-act="shareSheet"]').click();
        await page.locator('.modal.open .shrow', { hasText: 'Картинка' }).click();
        await expect(page.locator('.toast.show')).toContainText('Слишком часто', { timeout: 5000 });
        /* кнопка разблокирована — ретрай легален */
        await expect(page.locator('[data-act="shareSheet"]')).toBeEnabled();
        const ev = await (await request.get('/api/track-events')).json();
        expect(ev).toContain('cardClick');
        expect(ev).toContain('cardErr');
        expect(ev).not.toContain('cardOk');
    });


    test('[UX-S16] «Картинка»: busy ⏳ → cardOk', async ({ page, request }) => {
        test.setTimeout(60000);
        const today = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [], workouts: [doneWorkout(1, today, EX, '120', 3)]
        } } });
        /* zaderzhka otveta /api/card 2s: mgnovenny otvet localhost busy-ne poymat */
        await page.route('**/api/card', async function (route) {
            await new Promise(function (done) { setTimeout(done, 2000); });
            await route.continue();
        });
        await openApp(page);
        await page.locator('.pcard').first().click();
        const shareBtn = page.locator('[data-act="shareSheet"]');
        await expect(shareBtn).toBeVisible({ timeout: 5000 });
        await shareBtn.click();
        await page.locator('.modal.open .shrow', { hasText: 'Картинка' }).click();
        /* busy: knopka disabled, tekst ? Gotovim poster; potom tost uspeha */
        await expect(shareBtn).toBeDisabled();
        await expect(shareBtn).toContainText('⏳ Готовим постер…');
        await expect(page.locator('.toast.show')).toContainText('Постер', { timeout: 10000 });
        await expect(page.locator('.toast.show')).toContainText('чат');
        await expect(shareBtn).toBeEnabled();
        await expect(shareBtn).toContainText('Поделить');
        const ev = await (await request.get('/api/track-events')).json();
        expect(ev).toContain('cardOk');
        expect(ev).not.toContain('cardErr');
    });

    test('[UX-S16] «Картинка»: offline → cardErr bez cardOk', async ({ page, request }) => {
        test.setTimeout(60000);
        const today = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [], workouts: [doneWorkout(1, today, EX, '120', 3)]
        } } });
        await openApp(page);
        await page.locator('.pcard').first().click();
        await page.locator('[data-act="shareSheet"]').click();
        await expect(page.locator('.modal.open .shrow', { hasText: 'Картинка' })).toBeVisible({ timeout: 5000 });
        await page.context().setOffline(true);
        await page.locator('.modal.open .shrow', { hasText: 'Картинка' }).click();
        /* set padenie: tost kartochnogo potoka (poster), ne ssylochnogo (ssylkoj) */
        await expect(page.locator('.toast.show')).toContainText('Нет связи', { timeout: 5000 });
        await expect(page.locator('.toast.show')).toContainText('постер');
        await expect(page.locator('.toast.show')).not.toContainText('ссылку');
        await page.context().setOffline(false);
        /* knopka razblokirovana: retaj legalen, povtorniy tap pri seti - uspeh */
        await expect(page.locator('[data-act="shareSheet"]')).toBeEnabled();
        /* [TST-B1] повторный клик той же кнопки: дедуп dispatchFromEl (web/app.js)
           молча гасит клики по одной кнопке в окне 400 мс. На холодном headless-раннере
           вся offline-последовательность укладывалась в это окно — второй клик глотался,
           шит не открывался, тест вис до таймаута. Тост живёт 2,2 с: его исчезновение —
           детерминированный зазор > 400 мс. */
        await expect(page.locator('.toast.show')).toBeHidden({ timeout: 5000 });
        await page.locator('[data-act="shareSheet"]').click();
        await expect(page.locator('.modal.open .shrow', { hasText: 'Картинка' })).toBeVisible({ timeout: 5000 });
        await page.locator('.modal.open .shrow', { hasText: 'Картинка' }).click();
        await expect(page.locator('.toast.show')).toContainText('Постер', { timeout: 5000 });
        /* offline-tosty /api/track ne doezhayut; povtornyy uspeshnyy potok - doezhaet */
        const ev = await (await request.get('/api/track-events')).json();
        expect(ev).toContain('cardOk');
        expect(ev).not.toContain('cardErr');
    });

    test('страница /w/<id> рендерится, мусорный id — 404 «Тренировка недоступна»', async ({ request }) => {
        const today = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [], profile: { sex: 'м', age: 30, height: 180, weight: 90 },
            workouts: [doneWorkout(1, today, EX, '120', 3)]
        } } });
        const r = await request.post('/api/share', { data: { wid: 1 } });
        expect(r.ok()).toBeTruthy();
        const j = await r.json();
        expect(j.ok).toBe(true);
        expect(j.shareId).toMatch(/^[0-9a-zA-Z]{22}$/);
        const ok = await request.get('/w/' + j.shareId);
        expect(ok.status()).toBe(200);
        const html = await ok.text();
        expect(html).toContain('og:title');
        expect(html).toContain('только просмотр');
        expect(html).toContain(EX);
        expect(html).toContain('Попробовать в Telegram');
        /* [UX-B14] CTA ведёт на нашего бота (мок /w-страницы зеркалит прод-фолбэк) */
        expect(html).toContain('t.me/MyHelperGymBot/app');
        const bad = await request.get('/w/garbage0123456789abcdefghij');
        expect(bad.status()).toBe(404);
        expect(await bad.text()).toContain('Тренировка недоступна');
    });

    test('нет сети — тост об ошибке, без «Ссылка скопирована»', async ({ page, request }) => {
        test.setTimeout(60000);
        const today = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [], profile: { sex: 'м', age: 30, height: 180, weight: 90 },
            workouts: [doneWorkout(1, today, EX, '120', 3)]
        } } });
        await openApp(page);
        await page.locator('.pcard').first().click();
        await page.locator('[data-act="shareSheet"]').click();
        await page.context().setOffline(true);
        await page.locator('.modal.open .shrow.tg').click();
        await expect(page.locator('.toast.show')).toContainText('Нет связи', { timeout: 5000 });
        await page.context().setOffline(false);
        /* кнопка разблокирована — ретрай легален */
        await expect(page.locator('[data-act="shareSheet"]')).toBeEnabled();
        const ev = await (await request.get('/api/track-events')).json();
        expect(ev).not.toContain('linkCopy');
    });
});

/* ===== [UX-T40] «Разминка по дефолту»: тоггл в Настройках + автодобавка при старте ===== */
test.describe('UX-T40: разминка по дефолту', function () {
    test('тоггл выкл по умолчанию: строки селектора нет, новая тренировка без разминки', async ({ page, request }) => {
        await openApp(page);
        await page.locator('[aria-label="Настройки"]').click();
        const card = page.locator('.card', { hasText: '🏋️ Тренировка' });
        await expect(card).toBeVisible({ timeout: 5000 });
        const sw = card.locator('[role="switch"][aria-label="Разминка первым упражнением"]');
        await expect(sw).toHaveAttribute('aria-checked', 'false', { timeout: 5000 });
        /* прогрессивное раскрытие (§3.2): при выключенном тоггле строки селектора нет */
        await expect(card.locator('.arow')).toHaveCount(0);
        /* старт с пустого списка — разминки нет (E1) */
        await page.locator('.nav .nfab').click();
        await page.locator('.modal.open [data-act="closeModal"]').first().click();
        /* Настройки — оверлей поверх вкладки: «Назад» возвращает на открытую карточку */
        await page.locator('[data-act="closeSettings"]').click();
        await expect(page.locator('.expill')).toHaveCount(0, { timeout: 5000 });
        const st = await (await request.get('/api/state')).json();
        if (st.warmupFirst != null) throw new Error('дефолт тоггла должен быть null (ключ не пишется): ' + st.warmupFirst);
        if (!st.workouts || !st.workouts[0] || st.workouts[0].exercises.length !== 0) throw new Error('без тоггла разминка не должна добавляться');
    });

    test('вкл → новая тренировка стартует с «Разминка», настройка переживает перезагрузку', async ({ page, request }) => {
        await openApp(page);
        await page.locator('[aria-label="Настройки"]').click();
        const card = page.locator('.card', { hasText: '🏋️ Тренировка' });
        const sw = card.locator('[role="switch"][aria-label="Разминка первым упражнением"]');
        await sw.click();
        await expect(sw).toHaveAttribute('aria-checked', 'true', { timeout: 5000 });
        /* строка селектора появилась; значение — системная запись «Разминка · по умолчанию» */
        await expect(card.locator('.arow .aval')).toHaveText('Разминка · по умолчанию', { timeout: 5000 });
        /* GymData, не localStorage (§5): ждём тост сохранения и ключ на сервере */
        await expect(page.locator('.toast.show')).toHaveText('✓ Сохранено', { timeout: 5000 });
        const st = await (await request.get('/api/state')).json();
        if (st.warmupFirst !== true) throw new Error('warmupFirst не доехал до сервера: ' + st.warmupFirst);
        /* перезагрузка MA: тоггл остаётся включённым (не localStorage) */
        await page.reload();
        await expect(page.locator('#app .hero, #app .pcard').first()).toBeVisible({ timeout: 10000 });
        await page.locator('[aria-label="Настройки"]').click();
        await expect(page.locator('[role="switch"][aria-label="Разминка первым упражнением"]')).toHaveAttribute('aria-checked', 'true', { timeout: 5000 });
        /* новая тренировка: первым упражнением «Разминка» (§4.1), ровно один раз */
        await page.locator('.nav .nfab').click();
        await page.locator('.modal.open [data-act="closeModal"]').first().click();
        await page.locator('[data-act="closeSettings"]').click();
        const pill = page.locator('.expill').first();
        await expect(pill).toContainText('Разминка', { timeout: 5000 });
        await expect(page.locator('.expill')).toHaveCount(1);
        const st2 = await (await request.get('/api/state')).json();
        const exs = st2.workouts[0].exercises;
        if (exs.length !== 1 || exs[0].name !== 'Разминка' || exs[0].sets.length !== 0) {
            throw new Error('разминка должна быть первым пустым упражнением: ' + JSON.stringify(exs));
        }
    });

    test('выбор wcardio в селекторе → новая тренировка стартует с «Кардио-разминки» (ревью)', async ({ page, request }) => {
        await openApp(page);
        await page.locator('[aria-label="Настройки"]').click();
        const card = page.locator('.card', { hasText: '🏋️ Тренировка' });
        await card.locator('[role="switch"][aria-label="Разминка первым упражнением"]').click();
        await expect(page.locator('.toast.show')).toHaveText('✓ Сохранено', { timeout: 5000 });
        /* лист селектора: тап по каталогному упражнению — значение в карточке = имя */
        await card.locator('.arow', { hasText: 'Упражнение разминки' }).click();
        const sheet = page.locator('.modal.open');
        await sheet.locator('.pli', { hasText: 'Кардио-разминка' }).click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await expect(card.locator('.arow .aval')).toHaveText('Кардио-разминка (ходьба/лёгкий бег)', { timeout: 5000 });
        const st = await (await request.get('/api/state')).json();
        if (st.warmupEx !== 'wcardio') throw new Error('warmupEx=wcardio не доехал до сервера: ' + st.warmupEx);
        /* старт: разминка = каталогное упражнение (§2.4 — карточка/фото), первая пилюля */
        await page.locator('.nav .nfab').click();
        await page.locator('.modal.open [data-act="closeModal"]').first().click();
        await page.locator('[data-act="closeSettings"]').click();
        const pill = page.locator('.expill').first();
        await expect(pill).toContainText('Кардио-разминка (ходьба/лёгкий бег)', { timeout: 5000 });
        await expect(page.locator('.expill')).toHaveCount(1);
        const st2 = await (await request.get('/api/state')).json();
        if (st2.workouts[0].exercises[0].name !== 'Кардио-разминка (ходьба/лёгкий бег)') {
            throw new Error('первое упражнение не Кардио-разминка: ' + JSON.stringify(st2.workouts[0].exercises));
        }
    });

    test('устаревший warmupEx в данных → тихий резолв в «Разминку», старт без ошибок (ревью, E3)', async ({ page, request }) => {
        /* id отсутствует в каталоге — сервер хранит строку как есть (§5), резолв при старте (§2.6) */
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 1, del: [], warmupFirst: true, warmupEx: 'nonexistent', workouts: []
        } } });
        await openApp(page);
        await page.locator('.nav .nfab').click();
        await page.locator('.modal.open [data-act="closeModal"]').first().click();
        const pill = page.locator('.expill').first();
        await expect(pill).toContainText('Разминка', { timeout: 5000 });
        await expect(page.locator('.expill')).toHaveCount(1);
        const st = await (await request.get('/api/state')).json();
        if (st.warmupEx !== 'nonexistent') throw new Error('сервер должен хранить строку как есть (§5): ' + st.warmupEx);
        if (st.workouts[0].exercises[0].name !== 'Разминка') {
            throw new Error('устаревший id не резолвился в «Разминку»: ' + JSON.stringify(st.workouts[0].exercises));
        }
    });

    test('удалённая разминка не возвращается: в новой — ровно одна, в старой не появилась (§4.2)', async ({ page, request }) => {
        await openApp(page);
        await page.locator('[aria-label="Настройки"]').click();
        const card = page.locator('.card', { hasText: '🏋️ Тренировка' });
        const sw = card.locator('[role="switch"][aria-label="Разминка первым упражнением"]');
        await sw.click();
        await expect(page.locator('.toast.show')).toHaveText('✓ Сохранено', { timeout: 5000 });
        await page.locator('[data-act="closeSettings"]').click();

        /* старт №1: разминка первым упражнением */
        await page.locator('.nav .nfab').click();
        await page.locator('.modal.open [data-act="closeModal"]').first().click();
        await expect(page.locator('.expill')).toHaveCount(1, { timeout: 5000 });
        await expect(page.locator('.expill .exname')).toHaveText('Разминка');

        /* пользователь удаляет разминку из активной тренировки → сейв.
           Тоста успеха у удаления НЕТ (deleteExerciseGo — splice → await save → render,
           app.js:5298); прежний ассерт на «✓ Сохранено» ловил живой тост тоггла настроек
           (2.2 с) — на WebKit не успевал и падал (флейк предрелизного цикла 21.11).
           Подтверждение сохранения — состояние сервера: разминки в активной больше нет */
        await page.locator('.expill .exhead [data-act="deleteExercise"]').click();
        await page.locator('.modal.open [data-act="confirmYes"]').click();
        await expect(page.locator('.expill')).toHaveCount(0, { timeout: 5000 });
        await expect.poll(async function () {
            const s = await (await request.get('/api/state')).json();
            const act = (s.workouts || []).filter(function (x) { return !x.finished; })[0];
            return (act && act.exercises || []).map(function (e) { return e.name; }).join(',');
        }, { timeout: 8000 }).not.toContain('Разминка');

        /* завершить пустую нельзя (гвард) — пользователь добавляет реальное упражнение и завершает */
        await page.locator('[data-act="openPicker"]').click();
        await page.locator('.modal.open .secrow .chip', { hasText: 'Все' }).first().click();
        await page.locator('.modal.open .excard', { hasText: 'Жим штанги лёжа' }).first().click();
        await page.locator('#mWeight').fill('100');
        await page.locator('#mSets').fill('3');
        await page.locator('#mReps').fill('8-10');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await page.locator('.backbar [data-act="finishWorkout"]').click();
        await expect(page.locator('.toast.show')).toHaveText('✅ Тренировка завершена', { timeout: 5000 });
        const stOld = await (await request.get('/api/state')).json();
        const oldW = (stOld.workouts || []).filter(function (w) { return w.finished; })[0];
        const oldNames = (oldW && oldW.exercises || []).map(function (e) { return e.name; });
        if (oldNames.length !== 1 || oldNames[0] !== 'Жим штанги лёжа' || oldNames.indexOf('Разминка') !== -1) {
            throw new Error('в завершённой тренировке должна быть только «Жим…» без разминки: ' + JSON.stringify(oldNames));
        }

        /* старт №2 (есть история — выбор «С пустого списка»): разминка на месте РОВНО ОДНА */
        await page.locator('.nav .nfab').click();
        await page.locator('.modal.open [data-act="newBlank"]').click();
        await page.locator('.modal.open [data-act="closeModal"]').first().click();
        await expect(page.locator('.expill')).toHaveCount(1, { timeout: 5000 });
        await expect(page.locator('.expill .exname')).toHaveText('Разминка');
        const st = await (await request.get('/api/state')).json();
        const fresh = (st.workouts || []).filter(function (w) { return !w.finished; })[0];
        if (!fresh || fresh.exercises.length !== 1 || fresh.exercises[0].name !== 'Разминка' || fresh.exercises[0].sets.length !== 0) {
            throw new Error('новая тренировка должна стартовать с одной пустой «Разминкой»: ' + JSON.stringify(fresh && fresh.exercises));
        }
        /* в старой (завершённой) разминка не появилась */
        const oldW2 = (st.workouts || []).filter(function (w) { return w.finished; })[0];
        const oldNames2 = (oldW2.exercises || []).map(function (e) { return e.name; });
        if (oldNames2.length !== 1 || oldNames2.indexOf('Разминка') !== -1) {
            throw new Error('разминка вернулась в старую тренировку: ' + JSON.stringify(oldNames2));
        }
    });

    test('шаблон при включённом тоггле: список = шаблон, БЕЗ авто-добавки разминки (§4.3)', async ({ page, request }) => {
        const today = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [], warmupFirst: true,
            workouts: [],
            templates: [{ id: 1, name: 'Спина и бицепс', createdAt: today + 'T10:35:00',
                exercises: [{ name: 'Тяга верхнего блока', w: '60', s: 3, r: '10' }, { name: 'Подтягивания', w: '', s: 4, r: '8' }] }]
        } } });
        await openApp(page);
        await page.locator('.nav .nfab').click();
        const m = page.locator('.modal.open');
        await expect(m).toContainText('Новая тренировка', { timeout: 5000 });
        await m.locator('.tcard').click();
        await expect(page.locator('.toast.show')).toHaveText('📋 Шаблон применён: 2 упражнения', { timeout: 5000 });
        const names = page.locator('.expill .exname');
        await expect(names.nth(0)).toHaveText('Тяга верхнего блока', { timeout: 5000 });
        await expect(names.nth(1)).toHaveText('Подтягивания');
        await expect(page.locator('.expill')).toHaveCount(2);
        const st = await (await request.get('/api/state')).json();
        if (st.warmupFirst !== true) throw new Error('warmupFirst потерялся на сервере: ' + st.warmupFirst);
        const fresh = (st.workouts || []).filter(function (w) { return !w.finished; })[0];
        const list = (fresh && fresh.exercises || []).map(function (e) { return e.name; });
        if (list.length !== 2 || list[0] !== 'Тяга верхнего блока' || list[1] !== 'Подтягивания' || list.indexOf('Разминка') !== -1) {
            throw new Error('старт из шаблона не должен добавлять разминку: ' + JSON.stringify(list));
        }
    });
});
/* ============ [UX-T42/T43] навигация: BackButton Telegram, свайпы от краёв; fullscreen выпилен ============ */
test.describe('[UX-T42/T43] навигация: стек, BackButton, свайпы; fullscreen удалён', function () {
    /* открытие приложения с поддержкой BackButton в vendor-заглушке (версия >= 6.1) */
    async function openAppTg(page) {
        await page.goto('/#tgWebAppVersion=7.10');
        await expect(page.locator('#app .hero, #app .pcard').first()).toBeVisible({ timeout: 10000 });
    }
    /* состояние вендорного BackButton (то, чем управляет приложение) */
    async function bbVisible(page) {
        return page.evaluate(function () {
            return !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.BackButton
                && window.Telegram.WebApp.BackButton.isVisible);
        });
    }
    async function bbPress(page) {
        await page.evaluate(function () { window.Telegram.WebView.receiveEvent('back_button_pressed'); });
    }
    test('[UX-T42] BackButton Telegram: корень=hidden, подэкраны/модалка=visible, back_button_pressed = «Назад»', async ({ page }) => {
        await openAppTg(page);
        if (await bbVisible(page)) throw new Error('BackButton виден на корневой вкладке, должен быть скрыт');
        /* Настройки: подэкран -> кнопка Telegram видна; нажатие = тот же экранный «Назад» */
        await page.locator('.topbar [data-act="openSettings"]').click();
        await expect(page.locator('.topbar [data-act="closeSettings"]')).toBeVisible({ timeout: 5000 });
        if (!(await bbVisible(page))) throw new Error('BackButton скрыт на подэкране «Настройки»');
        await bbPress(page);
        await expect(page.locator('.topbar [data-act="openSettings"]')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.topbar [data-act="closeSettings"]')).toHaveCount(0);
        if (await bbVisible(page)) throw new Error('BackButton не скрылся после возврата на корень');
        /* Календарь: то же на втором подэкране */
        await page.evaluate(function () { localStorage.setItem('gymCalView', 'month'); });
        await page.locator('.topbar [data-act="openCal"]').click();
        await expect(page.locator('.cal-grid')).toBeVisible({ timeout: 5000 });
        if (!(await bbVisible(page))) throw new Error('BackButton скрыт на календаре');
        await bbPress(page);
        await expect(page.locator('.cal-grid')).toHaveCount(0);
        if (await bbVisible(page)) throw new Error('BackButton не скрылся после закрытия календаря');
        /* Модалка поверх корня (пикер): BackButton закрывает модалку, не экран */
        await page.locator('.nav .nfab').click();
        await expect(page.locator('.modal.open')).toBeVisible({ timeout: 5000 });
        if (!(await bbVisible(page))) throw new Error('BackButton скрыт при открытой модалке');
        await bbPress(page);
        await expect(page.locator('.modal.open')).toHaveCount(0);
        /* nfab сразу создаёт тренировку: после закрытия пикера мы на карточке, BackButton снова виден */
        await expect(page.locator('.backbar')).toBeVisible({ timeout: 5000 });
        if (!(await bbVisible(page))) throw new Error('BackButton не показался на карточке после закрытия модалки');
    });
    test('[UX-T42] BackButton на карточке тренировки: виден, нажатие закрывает карточку', async ({ page }) => {
        await openAppTg(page);
        await page.locator('.nav .nfab').click();
        const modal = page.locator('.modal.open');
        await modal.waitFor({ state: 'visible', timeout: 5000 });
        await modal.locator('.secrow .chip', { hasText: 'Все' }).first().click();
        await modal.locator('.excard', { hasText: EX }).first().click();
        await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 });
        await page.locator('#mWeight').fill('60');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await expect(page.locator('.backbar [data-act="closeHistory"]')).toBeVisible({ timeout: 5000 });
        if (!(await bbVisible(page))) throw new Error('BackButton скрыт на карточке тренировки');
        await bbPress(page);
        await expect(page.locator('.backbar')).toHaveCount(0);
        await expect(page.locator('.pcard').first()).toBeVisible({ timeout: 5000 });
        if (await bbVisible(page)) throw new Error('BackButton не скрылся после закрытия карточки');
    });
    /* синтетический свайп: старт в точке (x0,y0) со смещением (dx,dy); target = элемент начала жеста */
    async function swipe(page, x0, y0, dx, dy, targetSel) {
        await page.evaluate(function (o) {
            let el = document.getElementById('app');
            if (o.sel) { el = document.querySelector(o.sel); }
            const mkT = function (x, y) { return { identifier: 1, target: el, clientX: x, clientY: y }; };
            /* WebKit не даёт new Touch: собираем событие с own-полями, хендлер читает те же touches/changedTouches/target */
            const mkEv = function (type, touches, changed) {
                const ev = new Event(type, { bubbles: true, cancelable: true });
                Object.defineProperty(ev, 'touches', { value: touches });
                Object.defineProperty(ev, 'targetTouches', { value: touches });
                Object.defineProperty(ev, 'changedTouches', { value: changed });
                Object.defineProperty(ev, 'target', { value: el });
                return ev;
            };
            const mx = o.x0 + o.dx * 0.5, my = o.y0 + o.dy * 0.5;
            el.dispatchEvent(mkEv('touchstart', [mkT(o.x0, o.y0)], [mkT(o.x0, o.y0)]));
            el.dispatchEvent(mkEv('touchmove', [mkT(mx, my)], [mkT(mx, my)]));
            el.dispatchEvent(mkEv('touchend', [], [mkT(o.x0 + o.dx, o.y0 + o.dy)]));
        }, { x0: x0, y0: y0, dx: dx, dy: dy, sel: targetSel || null });
    }
    test('[UX-T42] свайпы от краёв: назад/вперёд, вертикаль и старт на кнопке не навигируют, вперёд гасится новым действием', async ({ page }) => {
        test.skip(!test.info().project.use.hasTouch, 'свайпы: только touch-проекты (android360, iphone13, pixel7)');
        await openApp(page);
        const vw = await page.evaluate(function () { return document.documentElement.clientWidth; });
        /* корень: свайп от левого края, назад некуда, экран не меняется */
        await swipe(page, 10, 300, 120, 0);
        await expect(page.locator('.topbar [data-act="openSettings"]')).toBeVisible({ timeout: 5000 });
        /* Настройки: свайп от левого края вправо = «Назад» */
        await page.locator('.topbar [data-act="openSettings"]').click();
        await expect(page.locator('.topbar [data-act="closeSettings"]')).toBeVisible({ timeout: 5000 });
        await swipe(page, 10, 300, 120, 0);
        await expect(page.locator('.topbar [data-act="closeSettings"]')).toHaveCount(0);
        /* свайп от правого края влево = «Вперёд», настройки открываются снова */
        await swipe(page, vw - 10, 300, -120, 0);
        await expect(page.locator('.topbar [data-act="closeSettings"]')).toBeVisible({ timeout: 5000 });
        /* вертикальный жест от края: не навигация (скролл списка), экран не трогаем */
        await swipe(page, 10, 300, 0, 220);
        await expect(page.locator('.topbar [data-act="closeSettings"]')).toBeVisible();
        /* жест, начатый на кнопке (стрелка в шапке настроек у левого края): тап, не свайп-навигация */
        await swipe(page, 10, 24, 120, 0, '.topbar [data-act="closeSettings"]');
        await expect(page.locator('.topbar [data-act="closeSettings"]')).toBeVisible();
        /* назад, затем новое навигационное действие (календарь): «вперёд» больше некуда */
        await swipe(page, 10, 300, 120, 0);
        await expect(page.locator('.topbar [data-act="closeSettings"]')).toHaveCount(0);
        await page.evaluate(function () { localStorage.setItem('gymCalView', 'month'); });
        await page.locator('.topbar [data-act="openCal"]').click();
        await expect(page.locator('.cal-grid')).toBeVisible({ timeout: 5000 });
        await swipe(page, vw - 10, 300, -120, 0);
        await expect(page.locator('.cal-grid')).toBeVisible(); /* вперёд погашен: календарь остался */
        /* назад с календаря свайпом работает */
        await swipe(page, 10, 300, 120, 0);
        await expect(page.locator('.cal-grid')).toHaveCount(0);
    });

    test('[UX-T43] fullscreen выпилен: gymFullscreen=1 мёртв, тогла нет, шапка обычной геометрии', async ({ page }) => {
        await page.addInitScript(function () {
            try { localStorage.setItem('gymFullscreen', '1'); } catch (e) { /* noop */ }
        });
        await openApp(page);
        const cls = await page.evaluate(function () { return document.body.className; });
        if ((' ' + cls + ' ').indexOf(' fs ') !== -1) throw new Error('класс body.fs на месте: ' + cls);
        const pad = await page.evaluate(function () {
            const cs = getComputedStyle(document.querySelector('.topbar'));
            return { pt: cs.paddingTop, pl: cs.paddingLeft };
        });
        if (pad.pt !== '10px' || pad.pl !== '12px') {
            throw new Error('шапка не в обычной геометрии 10px 12px (gymFullscreen=1 должен быть мёртв): ' + JSON.stringify(pad));
        }
        /* тогл «Полноэкранный режим» больше не существует нигде в UI (в т.ч. в Настройках) */
        await page.locator('.topbar [data-act="openSettings"]').click();
        await expect(page.locator('.topbar [data-act="closeSettings"]')).toBeVisible({ timeout: 5000 });
        const text = await page.evaluate(function () { return document.body.innerText; });
        if (text.indexOf('Полноэкран') !== -1) throw new Error('текст «Полноэкранный...» найден в UI Настроек');
    });
});

/* ===== [UX-B17] кэш статики и gzip (issue #319: Mini App перекачивал 660KB при каждом открытии) ===== */
test.describe('UX-B17: кэш и gzip статики', function () {

    test('gzip: app.js с Accept-Encoding: gzip — Content-Encoding, gzip-магия 1f 8b, меньше сырого', async ({ request, baseURL }) => {
        /* заголовки — через API-клиент (тело Playwright распаковывает прозрачно) */
        const gz = await request.get('/app.js', { headers: { 'Accept-Encoding': 'gzip' } });
        if (gz.status() !== 200) throw new Error('GET /app.js с gzip — ' + gz.status());
        if (gz.headers()['content-encoding'] !== 'gzip') {
            throw new Error('content-encoding: ' + JSON.stringify(gz.headers()['content-encoding']) + ', ожидался gzip');
        }
        const v = gz.headers()['vary'] || '';
        if (v.indexOf('Accept-Encoding') < 0) throw new Error('нет Vary: Accept-Encoding, есть: ' + JSON.stringify(v));
        /* сырые байты — прямым http-запросом: gzip-магия и размер сжатого тела */
        const base = new URL(baseURL || 'http://127.0.0.1:8099');
        const rawGz = await new Promise(function (resolve, reject) {
            const rq = http.request({ host: base.hostname, port: base.port, path: '/app.js', method: 'GET',
                headers: { 'Accept-Encoding': 'gzip' } }, function (rs) {
                const chunks = [];
                rs.on('data', function (c) { chunks.push(c); });
                rs.on('end', function () { resolve({ status: rs.statusCode, headers: rs.headers, body: Buffer.concat(chunks) }); });
            });
            rq.on('error', reject);
            rq.end();
        });
        if (rawGz.status !== 200) throw new Error('сырой GET /app.js — ' + rawGz.status);
        if (rawGz.body.length < 2 || rawGz.body[0] !== 0x1f || rawGz.body[1] !== 0x8b) {
            throw new Error('нет gzip-магии 1f 8b: ' + rawGz.body.subarray(0, 2).toString('hex'));
        }
        if (Number(rawGz.headers['content-length']) !== rawGz.body.length) {
            throw new Error('content-length ' + rawGz.headers['content-length'] + ' != размеру gzip-тела ' + rawGz.body.length);
        }
        /* сжатое тело строго меньше сырого файла (app.js ~360KB) */
        const fs = require('fs');
        const path = require('path');
        const orig = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'));
        if (rawGz.body.length >= orig.length) throw new Error('gzip не сжал: ' + rawGz.body.length + ' >= ' + orig.length);
    });

    test('без Accept-Encoding: gzip — нет Content-Encoding, тело байт-в-байт оригинал', async ({ request }) => {
        const fs = require('fs');
        const path = require('path');
        const orig = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'));
        const rawRes = await request.get('/app.js', { headers: { 'Accept-Encoding': 'identity' } });
        if (rawRes.headers()['content-encoding'] != null) {
            throw new Error('клиенту без gzip ушёл content-encoding: ' + JSON.stringify(rawRes.headers()['content-encoding']));
        }
        const body = await rawRes.body();
        if (!body.equals(orig)) throw new Error('тело без gzip не равно файлу: ' + body.length + ' vs ' + orig.length);
    });

    test('Cache-Control: версионная статика (js/css/img) — годовой immutable, html — no-cache', async ({ request }) => {
        const IMM = 'public, max-age=31536000, immutable';
        for (const p of ['/app.js', '/style.css', '/catalog.js', '/img/exercises/bench-0.jpg']) {
            const r = await request.get(p, { headers: { 'Accept-Encoding': 'identity' } });
            if (r.status() !== 200) throw new Error('GET ' + p + ' — ' + r.status());
            if (r.headers()['cache-control'] !== IMM) {
                throw new Error(p + ' cache-control: ' + JSON.stringify(r.headers()['cache-control']) + ', ожидался ' + IMM);
            }
        }
        /* HTML-документы — входные точки (в index.html ссылки на ?v=) — всегда ре-валидация */
        const home = await request.get('/');
        if (home.headers()['cache-control'] !== 'no-cache') {
            throw new Error('/ cache-control: ' + JSON.stringify(home.headers()['cache-control']) + ', ожидался no-cache');
        }
        const privacy = await request.get('/privacy.html');
        if (privacy.headers()['cache-control'] !== 'no-cache') {
            throw new Error('/privacy.html cache-control: ' + JSON.stringify(privacy.headers()['cache-control']) + ', ожидался no-cache');
        }
        /* API — no-store, как раньше (прод: sendJson → send с "no-store"); мок зеркалит прод
           (расхождение найдено в предрелизном цикле: у мока заголовка не было вовсе) */
        const apiGet = await request.get('/api/state');
        if (apiGet.headers()['cache-control'] !== 'no-store') {
            throw new Error('/api/state cache-control: ' + JSON.stringify(apiGet.headers()['cache-control']) + ', ожидался no-store');
        }
        const apiPost = await request.post('/api/init', { data: {} });
        if (apiPost.headers()['cache-control'] !== 'no-store') {
            throw new Error('/api/init cache-control: ' + JSON.stringify(apiPost.headers()['cache-control']) + ', ожидался no-store');
        }
        const apiHealth = await request.get('/health');
        if (apiHealth.headers()['cache-control'] !== 'no-store') {
            throw new Error('/health cache-control: ' + JSON.stringify(apiHealth.headers()['cache-control']) + ', ожидался no-store');
        }
    });

    test('HEAD на статику — 200 без тела, заголовки на месте', async ({ request }) => {
        const h = await request.head('/app.js');
        if (h.status() !== 200) throw new Error('HEAD /app.js — ' + h.status());
        const body = await h.body();
        if (body.length !== 0) throw new Error('HEAD вернул тело: ' + body.length + ' байт');
        if (!h.headers()['content-type']) throw new Error('HEAD без Content-Type');
        if (!h.headers()['cache-control']) throw new Error('HEAD без Cache-Control');
    });
});

/* ===== [EXR-T18] удаление «своих»: долгий тап → меню → подтверждение (issue #335) ===== */
test.describe('[EXR-T18] удаление «своих» упражнений', function () {

    const OWN1 = 'Жим Свенда стоя';
    const OWN2 = 'Тяга гантели в разножке';

    /* подсадка «своих» на сервер (G.customEx — [EXR-T14]) */
    async function seedOwn(request, names) {
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 1, del: [], customEx: names.map(function (n) { return { n: n, tags: [] }; }), workouts: []
        } } });
    }
    /* Техника → чип «Своё»; ждём первую карточку с data-custom */
    async function openOwnTech(page) {
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Техника' }).click();
        await page.locator('.secrow .chip', { hasText: 'Своё' }).first().click();
        await expect(page.locator('#techList .excard[data-custom]').first()).toBeVisible({ timeout: 5000 });
    }
    /* долгий тап (жест 500 мс, в тесте 600 мс): удержание мыши на центре карточки */
    async function holdOwn(page, card) {
        const b = await card.boundingBox();
        if (!b) throw new Error('карточка не найдена');
        const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.waitForTimeout(600);
        await page.mouse.up();
    }
    /* открытие меню жестом + выждать __lpGuard (450 мс) — клики по шиту легальны
       (реальный пользователь тапает по меню позже 450 мс после отпускания) */
    async function openOwnMenu(page, card) {
        await holdOwn(page, card);
        await page.waitForTimeout(500);
    }

    test('долгий тап открывает меню: имя, «🗑 Удалить упражнение» danger, «Отмена»; быстрый тап и звезда молчат', async ({ page, request }) => {
        await seedOwn(request, [OWN1, OWN2]);
        await openOwnTech(page);
        /* строка-совет видна при непустом списке (§9) */
        await expect(page.locator('#techList .lphint')).toHaveText('Совет: долгий тап на упражнении — меню');
        const card = page.locator('#techList .excard[data-custom]', { hasText: OWN1 }).first();
        /* быстрый тап — ничего (карточка некликабельна, как сегодня) */
        await card.click();
        await expect(page.locator('.modal.open')).toHaveCount(0);
        /* тап по звезде — тогл ★, меню не открывается */
        await card.locator('.star').click();
        await expect(page.locator('.modal.open')).toHaveCount(0);
        await expect(page.locator('#techList .excard[data-custom]', { hasText: OWN1 }).first().locator('.star')).toHaveClass(/fav/);
        /* долгий тап — меню: caption «Упражнение», имя-заголовок, danger-пункт, «Отмена» */
        await openOwnMenu(page, card);
        const modal = page.locator('.modal.open');
        await expect(modal).toBeVisible({ timeout: 5000 });
        await expect(modal.locator('.msub')).toHaveText('Упражнение');
        await expect(modal.locator('.mtitle')).toHaveText(OWN1);
        await expect(modal.locator('[data-act="ctxDelete"]')).toHaveText('🗑 Удалить упражнение');
        await expect(modal.locator('[data-act="ctxDelete"]')).toHaveClass(/danger/);
        /* красный — именно цветом var(--danger): сравнение с probe-элементом (тема-независимо) */
        const dangerOk = await modal.locator('[data-act="ctxDelete"]').evaluate(function (el) {
            const probe = document.createElement('span');
            probe.style.color = 'var(--danger)';
            document.body.appendChild(probe);
            const ok = getComputedStyle(probe).color === getComputedStyle(el).color;
            probe.remove();
            return ok;
        });
        if (!dangerOk) throw new Error('пункт удаления не в danger-цвете');
        await expect(modal.locator('[data-act="ctxCancel"]')).toHaveText('Отмена');
        /* тап по фону закрывает меню — список не изменился */
        await page.locator('#modal').click({ position: { x: 10, y: 10 } });
        await expect(page.locator('.modal.open')).toHaveCount(0);
        await expect(page.locator('#techList .excard[data-custom]')).toHaveCount(2);
    });

    test('жест отменяется движением >14px — меню не открывается (скролл побеждает)', async ({ page, request }) => {
        await seedOwn(request, [OWN1]);
        await openOwnTech(page);
        const card = page.locator('#techList .excard[data-custom]').first();
        const b = await card.boundingBox();
        const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.mouse.move(cx + 24, cy + 24, { steps: 4 }); /* уводим палец до срабатывания */
        await page.waitForTimeout(600);
        await page.mouse.up();
        await expect(page.locator('.modal.open')).toHaveCount(0);
        await expect(page.locator('#techList .excard[data-custom]')).toHaveCount(1);
    });

    test('«Отмена» закрывает без изменений; правый клик открывает то же меню', async ({ page, request }) => {
        await seedOwn(request, [OWN1, OWN2]);
        await openOwnTech(page);
        await openOwnMenu(page, page.locator('#techList .excard[data-custom]', { hasText: OWN2 }).first());
        const modal = page.locator('.modal.open');
        await expect(modal).toBeVisible({ timeout: 5000 });
        await modal.locator('[data-act="ctxCancel"]').click();
        await expect(page.locator('.modal.open')).toHaveCount(0);
        await expect(page.locator('#techList .excard[data-custom]')).toHaveCount(2);
        const st = await (await request.get('/api/state')).json();
        if ((st.customEx || []).length !== 2) throw new Error('база изменилась: ' + JSON.stringify(st.customEx));
        /* правый клик мыши = то же меню (решение 3) */
        await page.locator('#techList .excard[data-custom]', { hasText: OWN2 }).first().click({ button: 'right' });
        await expect(page.locator('.modal.open')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.modal.open .mtitle')).toHaveText(OWN2);
        await page.locator('.modal.open [data-act="ctxCancel"]').click();
        await expect(page.locator('.modal.open')).toHaveCount(0);
    });

    test('«Удалить» → диалог «Удалить упражнение «X»?» + пометка про тренировки; «Оставить» ничего не меняет', async ({ page, request }) => {
        await seedOwn(request, [OWN1, OWN2]);
        await openOwnTech(page);
        await openOwnMenu(page, page.locator('#techList .excard[data-custom]', { hasText: OWN1 }).first());
        const modal = page.locator('.modal.open');
        await modal.locator('[data-act="ctxDelete"]').click();
        await expect(modal.locator('.mtitle')).toHaveText('Удалить упражнение «' + OWN1 + '»?', { timeout: 5000 });
        await expect(modal.locator('.hint')).toContainText('Тренировки с этим упражнением останутся без изменений — удалим только из базы и подсказок.');
        await expect(modal.locator('.btn.danger')).toHaveText('Удалить');
        await modal.locator('.btn.sec', { hasText: 'Оставить' }).click();
        await expect(page.locator('.modal.open')).toHaveCount(0);
        await expect(page.locator('#techList .excard[data-custom]')).toHaveCount(2);
    });

    test('«Удалить»: карточка исчезла и не воскресает из истории, ★ чистится, тренировка не тронута', async ({ page, request }) => {
        const now = new Date();
        const day = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3));
        /* история с «своим» + база + ★: без томстона union воскресил бы карточку после удаления */
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            customEx: [{ n: OWN1, tags: [] }, { n: OWN2, tags: [] }],
            favs: [OWN2],
            workouts: [doneWorkout(1, day, OWN2, '20', 3)]
        } } });
        await openOwnTech(page);
        await expect(page.locator('#techList .excard[data-custom]', { hasText: OWN2 }).first().locator('.star')).toHaveClass(/fav/);
        await openOwnMenu(page, page.locator('#techList .excard[data-custom]', { hasText: OWN2 }).first());
        const modal = page.locator('.modal.open');
        await modal.locator('[data-act="ctxDelete"]').click();
        await modal.locator('.btn.danger', { hasText: 'Удалить' }).click();
        await expect(page.locator('.modal.open')).toHaveCount(0);
        /* карточка исчезла, соседка и строка-совет на месте */
        await expect(page.locator('#techList .excard[data-custom]', { hasText: OWN2 })).toHaveCount(0);
        await expect(page.locator('#techList .excard[data-custom]', { hasText: OWN1 })).toHaveCount(1);
        await expect(page.locator('#techList .lphint')).toBeVisible();
        /* томстон на сервере [EXR-T19] */
        await expect.poll(async function () {
            const s = await (await request.get('/api/state')).json();
            return (s.customExHidden || []).indexOf(OWN2);
        }).toBeGreaterThanOrEqual(0);
        /* сервер: база и ★ почистились, тренировка нетронута (сеты, вес, имя) */
        await expect.poll(async function () {
            const s = await (await request.get('/api/state')).json();
            return (s.customEx || []).length + ':' + (s.favs || []).length;
        }).toBe('1:0');
        const st = await (await request.get('/api/state')).json();
        if ((st.favs || []).indexOf(OWN2) !== -1) throw new Error('★ не почистился: ' + JSON.stringify(st.favs));
        const w = (st.workouts || [])[0];
        if (!w || !w.exercises || w.exercises[0].name !== OWN2 || !w.exercises[0].sets.length || w.exercises[0].sets[0].w !== '20') {
            throw new Error('тренировка изменилась после удаления: ' + JSON.stringify(w));
        }
        /* пере-рендер (перезагрузка): удалённое не вернулось из истории */
        await page.reload();
        await page.locator('.nav button', { hasText: 'Техника' }).click();
        await page.locator('.secrow .chip', { hasText: 'Своё' }).first().click();
        await expect(page.locator('#techList .excard[data-custom]', { hasText: OWN2 })).toHaveCount(0, { timeout: 5000 });
        await expect(page.locator('#techList .excard[data-custom]', { hasText: OWN1 })).toHaveCount(1);
    });

    test('каталог не трогается: правый клик и долгий тап на карточке «Все» не открывают меню', async ({ page, request }) => {
        await seedOwn(request, [OWN1]);
        await openOwnTech(page);
        await page.locator('.secrow .chip', { hasText: 'Все' }).first().click();
        await expect(page.locator('#techList .excard[data-custom]')).toHaveCount(0);
        const card = page.locator('#techList .excard', { hasText: EX }).first();
        await expect(card).toBeVisible({ timeout: 5000 });
        /* правый клик — ни нативного контекст-меню, ни меню удаления */
        await card.click({ button: 'right' });
        await expect(page.locator('.modal.open')).toHaveCount(0);
        /* долгий тап — меню «своего» не открывается; отпускание = обычный тап по каталогу
           (открывает карточку упражнения, как сегодня — поведение каталога не менялось) */
        await holdOwn(page, card);
        await expect(page.locator('.modal.open')).toHaveCount(0);
    });

    test('удаление последнего «своего» — пустое состояние, строки-совета нет', async ({ page, request }) => {
        await seedOwn(request, [OWN1]);
        await openOwnTech(page);
        await openOwnMenu(page, page.locator('#techList .excard[data-custom]').first());
        const modal = page.locator('.modal.open');
        await modal.locator('[data-act="ctxDelete"]').click();
        await modal.locator('.btn.danger', { hasText: 'Удалить' }).click();
        await expect(page.locator('.modal.open')).toHaveCount(0);
        await expect(page.locator('#techList .excard[data-custom]')).toHaveCount(0);
        await expect(page.locator('#techList .lphint')).toHaveCount(0);
        await expect(page.locator('#techList .empty')).toContainText('Своих упражнений пока нет');
    });

    test('пересоздание удалённого имени снимает томстон — снова в подсказках (сценарий E §4)', async ({ page, request }) => {
        const now = new Date();
        const day = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3));
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [], customEx: [{ n: OWN2, tags: [] }],
            workouts: [doneWorkout(1, day, OWN2, '20', 3)]
        } } });
        await openOwnTech(page);
        await openOwnMenu(page, page.locator('#techList .excard[data-custom]', { hasText: OWN2 }).first());
        const modal = page.locator('.modal.open');
        await modal.locator('[data-act="ctxDelete"]').click();
        await modal.locator('.btn.danger', { hasText: 'Удалить' }).click();
        await expect(page.locator('.modal.open')).toHaveCount(0);
        await expect(page.locator('#techList .excard[data-custom]', { hasText: OWN2 })).toHaveCount(0);
        /* пересоздание с тем же именем из тренировки */
        await page.locator('.nav .nfab').click();
        await page.locator('.modal.open [data-act="newBlank"]').click();
        await page.locator('.modal.open [data-act="closeModal"]').first().click(); /* пикер после старта закрываем */
        await openActiveDetail(page);
        await page.locator('[data-act="openPicker"]').click();
        await page.locator('[data-act="customExerciseModal"]').click();
        await page.locator('#mCustomName').fill(OWN2);
        await page.locator('[data-act="createCustom"]').click();
        await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 }); /* создание прошло */
        await page.locator('.modal.open [data-act="closeModal"]').first().click();
        /* Техника «Своё»: имя вернулось (томстон снят) */
        await page.locator('.nav button', { hasText: 'Техника' }).click();
        await page.locator('.secrow .chip', { hasText: 'Своё' }).first().click();
        await expect(page.locator('#techList .excard[data-custom]', { hasText: OWN2 }).first()).toBeVisible({ timeout: 5000 });
    });

    /* ревью (важно): union-источники оба закрыты томстоном — «своё» сеется В БАЗЕ и
       ИСПОЛЬЗУЕТСЯ в тренировке (сеты без веса, чтобы «Из истории» мастера целей
       не подмешивало имя по e1RM); после удаления имени нет во ВСЕХ потребителях:
       Техника «Своё» (а), пикер «Коллекции → Свои» (б), список мастера целей (в) */
    test('удаление действует на всех потребителей: Техника «Своё», пикер «Коллекции → Свои», мастер целей', async ({ page, request }) => {
        const day = isoDate(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - 2));
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            customEx: [{ n: OWN1, tags: [] }],
            workouts: [{ id: 1, date: day, started: day + 'T09:30:00', ended: day + 'T10:00:00', finished: true, title: '', nutrition: '',
                exercises: [{ name: OWN1, st: day + 'T09:31:00', en: day + 'T09:50:00',
                    sets: [{ w: '', s: 3, r: '8-10', t: day + 'T09:32:00' }] }] }]
        } } });
        await openOwnTech(page);
        await openOwnMenu(page, page.locator('#techList .excard[data-custom]', { hasText: OWN1 }).first());
        await page.locator('.modal.open [data-act="ctxDelete"]').click();
        await page.locator('.modal.open [data-act="ctxRemove"]').click();
        await expect(page.locator('.modal.open')).toHaveCount(0);
        /* (а) Техника «Своё» — карточки нет (детально — сценарий «не воскресает» выше) */
        await expect(page.locator('#techList .excard[data-custom]', { hasText: OWN1 })).toHaveCount(0, { timeout: 5000 });
        /* (б) пикер «Коллекции → Свои» — имени нет */
        await page.locator('.nav .nfab').click();
        await page.locator('.modal.open [data-act="newBlank"]').click();
        await expect(page.locator('.modal.open #pickerQ')).toBeVisible({ timeout: 5000 });
        await page.locator('.modal.open .secrow .chip', { hasText: 'Коллекции' }).click();
        await page.locator('.modal.open #pickerCats .chip', { hasText: 'Свои' }).click();
        await expect(page.locator('#pickerList .excard', { hasText: OWN1 })).toHaveCount(0, { timeout: 5000 });
        await page.locator('.modal.open [data-act="closeModal"]').first().click();
        /* (в) мастер целей, шаг выбора упражнения — имени нет в #gwList */
        await page.locator('[data-act="switchTab"][data-a="stats"]').click();
        await page.locator('[data-act="openGoals"]').click();
        await page.locator('[data-act="goalNew"]').click();
        await page.locator('[data-act="gwType"][data-a="1"]').click();
        await expect(page.locator('#gwList')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#gwList .frow', { hasText: OWN1 })).toHaveCount(0, { timeout: 5000 });
        /* сервер: база пуста, тренировка (потребитель №4) не тронута; томстон в localStorage */
        const st = await (await request.get('/api/state')).json();
        if ((st.customEx || []).length !== 0) throw new Error('база не пуста после удаления: ' + JSON.stringify(st.customEx));
        const w = (st.workouts || []).filter(function (x) { return x.finished; })[0];
        if (!w || !w.exercises || w.exercises[0].name !== OWN1
            || w.exercises[0].sets.length !== 1 || w.exercises[0].sets[0].s !== 3) {
            throw new Error('тренировка изменилась после удаления: ' + JSON.stringify(w));
        }
        /* сервер: томстон [EXR-T19] */
        await expect.poll(async function () {
            const s = await (await request.get('/api/state')).json();
            return (s.customExHidden || []).indexOf(OWN1);
        }).toBeGreaterThanOrEqual(0);
    });

    /* [EXR-T19] миграция: старый клиент [EXR-T18] держал томстоны в localStorage
       (gymCustomExHidden). При загрузке имена, которых нет на сервере, переносятся в
       G.customHidden → сервер (merge), ключ localStorage очищается, подсказки имя
       не показывают (union-воскрешение из истории глушится уже при первом рендере). */
    test('миграция: localStorage-томстон переезжает на сервер, ключ чистится, подсказки имя не показывают', async ({ page, request }) => {
        const now = new Date();
        const day = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3));
        /* сервер: база с OWN1 + история с OWN2 (в базе T18-клиента OWN2 уже НЕТ — удалён:
           removeCustom убирал имя из базы и клал томстон в localStorage) — union без
           томстона воскресил бы карточку из истории */
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            customEx: [{ n: OWN1, tags: [] }],
            workouts: [doneWorkout(1, day, OWN2, '20', 3)]
        } } });
        /* сеем legacy-ключ старого клиента до загрузки app.js */
        await page.addInitScript(function (n) {
            try { localStorage.setItem('gymCustomExHidden', JSON.stringify([n])); } catch (e) { /* noop */ }
        }, OWN2);
        await openOwnTech(page);
        /* подсказки не показывают удалённое (фильтр работает уже при первом рендере) */
        await expect(page.locator('#techList .excard[data-custom]', { hasText: OWN2 })).toHaveCount(0, { timeout: 5000 });
        await expect(page.locator('#techList .excard[data-custom]', { hasText: OWN1 })).toHaveCount(1);
        /* томстон оказался на сервере */
        await expect.poll(async function () {
            const s = await (await request.get('/api/state')).json();
            return (s.customExHidden || []).indexOf(OWN2);
        }).toBeGreaterThanOrEqual(0);
        /* localStorage-ключ почищен после подтверждённого сохранения */
        await expect.poll(async function () {
            return page.evaluate(function () { return localStorage.getItem('gymCustomExHidden'); });
        }).toBe(null);
    });

    /* [EXR-T19] fail-path миграции: save падает — ключ gymCustomExHidden ЖИВЁТ
       (миграция повторится при следующем init — идемпотентно), томстона на сервере
       ещё нет; retry (reload без сбоя) — ключ почищен, томстон на сервере */
    test('миграция: save-error держит ключ gymCustomExHidden; retry чистит и льёт томстон на сервер', async ({ page, request }) => {
        const day = isoDate(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - 3));
        /* сервер: база с OWN1 + история с OWN2 — union без томстона воскресил бы карточку */
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            customEx: [{ n: OWN1, tags: [] }],
            workouts: [doneWorkout(1, day, OWN2, '20', 3)]
        } } });
        let failSave = true;
        await page.route('/api/save', async function (route) {
            if (failSave) await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
            else await route.continue();
        });
        await page.addInitScript(function (n) {
            try { localStorage.setItem('gymCustomExHidden', JSON.stringify([n])); } catch (e) { /* noop */ }
        }, OWN2);
        await openOwnTech(page); /* init → migrateCustomFavs → save (падает) */
        /* ключ пережил сбой сохранения */
        const k = await page.evaluate(function () { return localStorage.getItem('gymCustomExHidden'); });
        if (k === null) throw new Error('gymCustomExHidden должен пережить save-error, а ключ пуст');
        /* томстон не доехал до сервера */
        const s1 = await (await request.get('/api/state')).json();
        if ((s1.customExHidden || []).length !== 0) {
            throw new Error('томстон утёк на сервер при save-error: ' + JSON.stringify(s1.customExHidden));
        }
        failSave = false;
        await page.reload();
        await page.locator('.nav button', { hasText: 'Техника' }).click();
        await page.locator('.secrow .chip', { hasText: 'Своё' }).first().click();
        /* подсказки имя не показывают уже при первом рендере после retry */
        await expect(page.locator('#techList .excard[data-custom]', { hasText: OWN2 })).toHaveCount(0, { timeout: 5000 });
        /* ключ почищен после подтверждённого 'ok', томстон на сервере */
        await expect.poll(async function () {
            return page.evaluate(function () { return localStorage.getItem('gymCustomExHidden'); });
        }, { timeout: 8000 }).toBe(null);
        await expect.poll(async function () {
            const s = await (await request.get('/api/state')).json();
            return (s.customExHidden || []).length;
        }, { timeout: 8000 }).toBe(1);
    });


    /* acc §12.12: активная тренировка с удаляемым упражнением — запись продолжается,
       после завершения история на месте */
    test('удаление «своего» при активной тренировке: карточка и записи на месте, запись продолжается, история после завершения', async ({ page, request }) => {
        const today = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            customEx: [{ n: OWN1, tags: [] }],
            workouts: [{ id: 1, date: today, started: today + 'T09:30:00', ended: '', finished: false, title: '', nutrition: '',
                exercises: [{ name: OWN1, st: today + 'T09:31:00', en: '', sets: [{ w: '60', s: 2, r: '10', t: today + 'T09:32:00' }] }] }]
        } } });
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Техника' }).click();
        await page.locator('.secrow .chip', { hasText: 'Своё' }).first().click();
        await expect(page.locator('#techList .excard[data-custom]').first()).toBeVisible({ timeout: 5000 });
        await openOwnMenu(page, page.locator('#techList .excard[data-custom]').first());
        await page.locator('.modal.open [data-act="ctxDelete"]').click();
        await page.locator('.modal.open [data-act="ctxRemove"]').click();
        await expect(page.locator('.modal.open')).toHaveCount(0);
        /* возврат в активную тренировку: упражнение НА МЕСТЕ, записи не тронуты */
        await page.locator('.nav button', { hasText: 'История' }).click();
        await page.locator('.pcard').first().click();
        await expect(page.locator('.wcicons').first()).toBeVisible({ timeout: 5000 });
        const pill = page.locator('.expill', { hasText: OWN1 });
        await expect(pill).toHaveCount(1, { timeout: 5000 });
        await expect(pill.locator('.entry').first()).toContainText('60 кг, 2 подхода по 10 повторений', { timeout: 5000 });
        /* запись продолжается: ещё один подход — вес предыдущего подставлен */
        await pill.locator('.ex-addset[data-act="openEntryModal"]').click();
        await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#mWeight')).toHaveValue('60');
        await page.locator('#mWeight').fill('65');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await expect(pill.locator('.entry')).toHaveCount(2, { timeout: 5000 });
        /* завершение: остаёмся в карточке [FIT-T1]; история на месте — превью с «своим» упражнением */
        await page.locator('.backbar [data-act="finishWorkout"]').click();
        await expect(page.locator('.mapcard')).toBeVisible({ timeout: 5000 });
        await page.locator('.backbar [data-act="closeHistory"]').click();
        await expect(page.locator('.pcard').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.pc-ex', { hasText: OWN1 }).first()).toBeVisible({ timeout: 5000 });
        const st = await (await request.get('/api/state')).json();
        const fin = (st.workouts || []).filter(function (x) { return x.finished; })[0];
        if (!fin || !fin.exercises || fin.exercises[0].name !== OWN1 || fin.exercises[0].sets.length !== 2
            || fin.exercises[0].sets[1].w !== '65') {
            throw new Error('история после завершения не та: ' + JSON.stringify(fin));
        }
    });

    /* XSS-пин: имя-инъекция попадает в меню и диалог как ТЕКСТ (esc) — ни img-узла,
       ни сработавшего alert, ни исключений; удаление проходит штатно */
    test('XSS-пин: имя-инъекция рендерится текстом в меню и диалоге, без img/alert/ошибок', async ({ page, request }) => {
        const XSS = '<img src=x onerror=alert(1)>';
        const problems = [];
        page.on('pageerror', function (e) { problems.push('pageerror: ' + String(e)); });
        page.on('console', function (m) {
            /* сетевой шум («Failed to load resource») — не про экранирование; ловим ошибки скрипта */
            if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) problems.push('console: ' + m.text());
        });
        const dialogs = [];
        page.on('dialog', function (d) { dialogs.push(d.type() + ':' + d.message()); return d.dismiss().catch(function () {}); });
        await seedOwn(request, [XSS]);
        await openOwnTech(page);
        const card = page.locator('#techList .excard[data-custom]').first();
        await openOwnMenu(page, card);
        const modal = page.locator('.modal.open');
        await expect(modal).toBeVisible({ timeout: 5000 });
        /* имя как ТЕКСТ (toHaveText сравнивает literal), img-узла нет, alert не сработал */
        await expect(modal.locator('.mtitle')).toHaveText(XSS);
        await expect(modal.locator('img')).toHaveCount(0);
        /* диалог подтверждения тоже экранирован */
        await modal.locator('[data-act="ctxDelete"]').click();
        await expect(modal.locator('.mtitle')).toHaveText('Удалить упражнение «' + XSS + '»?', { timeout: 5000 });
        await expect(modal.locator('img')).toHaveCount(0);
        /* удаление без исключений: карточка исчезла */
        await modal.locator('[data-act="ctxRemove"]').click();
        await expect(page.locator('.modal.open')).toHaveCount(0);
        await expect(page.locator('#techList .excard[data-custom]')).toHaveCount(0);
        /* томстон на сервере [EXR-T19] */
        await expect.poll(async function () {
            const s = await (await request.get('/api/state')).json();
            return (s.customExHidden || []).indexOf(XSS);
        }).toBeGreaterThanOrEqual(0);
        if (dialogs.length) throw new Error('alert сработал (XSS исполнился): ' + JSON.stringify(dialogs));
        if (problems.length) throw new Error('ошибки страницы/консоли: ' + JSON.stringify(problems.slice(0, 5)));
    });
});

/* ============ [UX-S17] заметка тренировки (docs/spec-ux-s17-notes.md, ред. 2) ============ */
test.describe('[UX-S17] заметка тренировки', function () {

    const NOTE = 'Тяга пошла легче — попробовать 50 кг.';
    const NOTE_MORE = 'Тяга пошла легче — попробовать 50 кг. Дописал после тренировки.';

    /* чек-лист §9.1: поле с плейсхолдером в карточке активной тренировки, после
       «➕ Добавить упражнение», до details; maxlength 1000; пустое поле — одна строка */
    test('плейсхолдер виден на пустом поле, позиция после «Добавить упражнение»', async ({ page }) => {
        await openApp(page);
        await startWorkoutUi(page);
        const ta = page.locator('textarea.notefield');
        await expect(ta).toBeVisible({ timeout: 5000 });
        await expect(ta).toHaveAttribute('placeholder', 'Добавить заметку');
        await expect(ta).toHaveAttribute('maxlength', '1000');
        expect(await ta.inputValue()).toBe('');
        /* порядок блоков карточки: «Добавить упражнение» < заметка < details */
        const order = await page.evaluate(function () {
            const ta = document.querySelector('textarea.notefield');
            if (!ta) return 'нет поля заметки';
            const card = document.getElementById('w' + ta.getAttribute('data-wid'));
            if (!card || !card.contains(ta)) return 'карточка w<id> не найдена';
            const seq = Array.prototype.map.call(card.children, function (el) {
                if (el.tagName === 'TEXTAREA' && el.classList.contains('notefield')) return 'note';
                if (el.tagName === 'DETAILS') return 'details';
                if (el.classList.contains('btnrow') && el.textContent.indexOf('Добавить упражнение') >= 0) return 'add';
                return '';
            }).filter(Boolean);
            return seq.join('>');
        });
        expect(order).toBe('add>note>details');
    });

    /* чек-лист §9.2: пусто — 1 строка; рост с вводом; максимум 4 строки — высота
       фиксируется, дальше внутренний скролл (overflow-y: auto); очистка — снова 1 строка */
    test('авто-высота: рост с вводом, кап на 4 строках — дальше внутренний скролл', async ({ page }) => {
        await openApp(page);
        await startWorkoutUi(page);
        const ta = page.locator('textarea.notefield');
        await expect(ta).toBeVisible({ timeout: 5000 });
        await ta.fill('Одна строка');
        const h1 = (await ta.boundingBox()).height;
        await ta.fill('Строка один\nСтрока два\nСтрока три\nСтрока четыре');
        const h4 = (await ta.boundingBox()).height;
        expect(h4).toBeGreaterThan(h1 * 2.2); /* четыре строки выше одной */
        await ta.fill('Строка один\nСтрока два\nСтрока три\nСтрока четыре\nСтрока пять\nСтрока шесть\nСтрока семь\nСтрока восемь');
        const h8 = (await ta.boundingBox()).height;
        expect(Math.abs(h8 - h4)).toBeLessThanOrEqual(3); /* после 4 строк высота не растёт */
        const m = await ta.evaluate(function (el) {
            return { ov: el.style.overflowY, scr: el.classList.contains('scr'), sh: el.scrollHeight, ch: el.clientHeight };
        });
        expect(m.ov).toBe('auto'); /* внутренний скролл включён */
        expect(m.scr).toBeTruthy();
        expect(m.sh).toBeGreaterThan(m.ch); /* контента больше видимой высоты */
        await ta.fill(''); /* очистка — возврат к одной строке */
        const hClr = (await ta.boundingBox()).height;
        expect(Math.abs(hClr - h1)).toBeLessThanOrEqual(3);
    });

    /* чек-лист §9.3: debounce-автосейв доезжает до сервера, текст живёт после
       перезагрузки; автосейв тихий: без тоста успеха и без render() (фокус на месте) */
    test('набранный текст живёт после перезагрузки, фокус не сбрасывается, тоста нет', async ({ page, request }) => {
        await openApp(page);
        await startWorkoutUi(page);
        const ta = page.locator('textarea.notefield');
        await expect(ta).toBeVisible({ timeout: 5000 });
        const saveDone = page.waitForResponse(function (r) {
            return r.url().indexOf('/api/save') >= 0 && r.request().method() === 'POST';
        });
        await ta.fill(NOTE);
        const resp = await saveDone;
        expect(resp.status()).toBe(200);
        /* серверное состояние: note на объекте тренировки */
        const st = await (await request.get('/api/state')).json();
        expect(st.workouts[0].note).toBe(NOTE);
        /* автосейв без render(): фокус остался в поле (render пересоздал бы DOM) */
        expect(await page.evaluate(function () {
            return !!document.activeElement && document.activeElement.classList.contains('notefield');
        })).toBe(true);
        /* без тоста успеха */
        await page.waitForTimeout(250);
        await expect(page.locator('.toast.show')).toHaveCount(0);
        /* persist: после перезагрузки значение берётся с сервера */
        await page.reload();
        await openActiveDetail(page);
        await expect(page.locator('textarea.notefield')).toHaveValue(NOTE, { timeout: 10000 });
    });

    /* чек-лист §9.5: заметка в завершённой карточке — видна, редактируется тем же полем;
       blur — немедленный flush без тоста; pcard-превью заметку не показывает */
    test('заметка в завершённой карточке: правка и flush на blur; pcard без заметки', async ({ page, request }) => {
        const today = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [], profile: { sex: 'м', age: 30, height: 180, weight: 90 },
            workouts: [Object.assign(doneWorkout(1, today, EX, '120', 3), { note: NOTE })]
        } } });
        await openApp(page);
        /* pcard — плотное превью: заметка там не нужна (§7 спеки) */
        await expect(page.locator('.pcard').first()).not.toContainText(NOTE);
        await page.locator('.pcard').first().click();
        const ta = page.locator('textarea.notefield');
        await expect(ta).toHaveValue(NOTE, { timeout: 5000 });
        /* правка у завершённой разрешена; blur — немедленный flush */
        const saveDone = page.waitForResponse(function (r) {
            return r.url().indexOf('/api/save') >= 0 && r.request().method() === 'POST';
        });
        await ta.fill(NOTE_MORE);
        await ta.blur();
        const resp = await saveDone;
        expect(resp.status()).toBe(200);
        const st = await (await request.get('/api/state')).json();
        expect(st.workouts[0].note).toBe(NOTE_MORE);
        await page.waitForTimeout(250);
        await expect(page.locator('.toast.show')).toHaveCount(0);
    });

    /* чек-лист §9.5: заметка не попадает в share — ни в пейлоад /api/share, ни на страницу /w/ */
    test('заметка не попадает в share-пейлоад и на страницу /w/<id>', async ({ page, context, request }) => {
        /* моки Telegram/clipboard — тот же паттерн, что у [UX-I16] (выше): без них
           openTelegramLink уходит в window.open и страница навигируется на t.me */
        await context.addInitScript(function () {
            let tries = 0;
            const t = setInterval(function () {
                tries++;
                const w = window.Telegram || (window.Telegram = {});
                const app = w.WebApp;
                if (app && !app.__mocked) {
                    app.__mocked = true;
                    app.__opened = [];
                    app.openTelegramLink = function (url) { app.__opened.push(url); };
                }
                if ((app && app.__mocked) || tries > 400) clearInterval(t);
            }, 25);
        });
        await context.addInitScript(function () {
            const mem = [];
            try {
                Object.defineProperty(navigator, 'clipboard', {
                    configurable: true,
                    value: {
                        writeText: function (t) { mem.push(String(t)); return Promise.resolve(); },
                        readText: function () { return Promise.resolve(mem.length ? mem[mem.length - 1] : ''); }
                    }
                });
            } catch (e) { /* движок не дал переопределить — тост ловит ветку ниже */ }
        });
        const today = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [], profile: { sex: 'м', age: 30, height: 180, weight: 90 },
            workouts: [Object.assign(doneWorkout(1, today, EX, '120', 3), { note: NOTE })]
        } } });
        await openApp(page);
        await page.locator('.pcard').first().click();
        let sharePayload = null;
        await page.route('**/api/share', async function (route) {
            sharePayload = route.request().postData();
            await route.continue();
        });
        await page.locator('[data-act="shareSheet"]').click();
        await page.locator('.modal.open .shrow.tg').click();
        await expect(page.locator('.toast.show')).toContainText('Ссылка скопирована', { timeout: 5000 });
        /* пейлоад — только initData/wid/shareName, заметки там нет */
        expect(sharePayload).toBeTruthy();
        expect(sharePayload).not.toContain(NOTE);
        expect(sharePayload).not.toContain('"note"');
        /* публичная страница без текста заметки */
        const st = await (await request.get('/api/state')).json();
        const sid = st.workouts[0].shareId;
        expect(sid).toBeTruthy();
        const html = await (await request.get('/w/' + sid)).text();
        expect(html).toContain(EX);
        expect(html).not.toContain(NOTE);
        /* открытие выбора чата — через мок Telegram, без навигации страницы */
        const opened = await page.evaluate(function () { return window.Telegram.WebApp.__opened; });
        expect(opened.length).toBe(1);
        expect(decodeURIComponent(opened[0])).toContain('/w/' + sid);
    });

    /* чек-лист §9.5: заметка переживает завершение тренировки — на месте в завершённой карточке,
       редактируется тем же полем; правка доезжает до сервера */
    test('заметка переживает завершение тренировки', async ({ page, request }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await page.locator('#mWeight').fill('50');
        await page.locator('#mSets').fill('1');
        await page.locator('#mReps').fill('10');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await openActiveDetail(page);
        const ta = page.locator('textarea.notefield');
        await expect(ta).toBeVisible({ timeout: 5000 });
        /* ждём сейв с заметкой в пейлоаде (не фоновый сейв записи) */
        const noteSaved = page.waitForResponse(function (r) {
            return r.url().indexOf('/api/save') >= 0 && r.request().method() === 'POST'
                && (r.request().postData() || '').indexOf('note') >= 0;
        });
        await ta.fill(NOTE);
        expect((await noteSaved).status()).toBe(200);
        /* [FIT-T1] решение владельца 1-А (23.11, меняет [UX-T13]): после завершения
           остаёмся в открытой карточке — заметка на месте в ней же (§9.5);
           backbar переключается на завершённый набор, «← Назад» — в историю как раньше */
        await page.locator('.backbar [data-act="finishWorkout"]').click();
        await expect(page.locator('.backbar', { hasText: 'Повторить' })).toBeVisible({ timeout: 5000 });
        const fin = page.locator('textarea.notefield');
        await expect(fin).toHaveValue(NOTE, { timeout: 5000 });
        /* редактируется тем же полем: правка + blur — flush до сервера */
        const editSaved = page.waitForResponse(function (r) {
            return r.url().indexOf('/api/save') >= 0 && r.request().method() === 'POST'
                && (r.request().postData() || '').indexOf('note') >= 0;
        });
        await fin.fill(NOTE_MORE);
        await fin.blur();
        expect((await editSaved).status()).toBe(200);
        const st = await (await request.get('/api/state')).json();
        const finW = (st.workouts || []).filter(function (x) { return x.finished; })[0];
        if (!finW) throw new Error('завершённой тренировки нет на сервере');
        if (finW.note !== NOTE_MORE) throw new Error('правка не сохранилась: ' + JSON.stringify(finW.note));
    });
});

/* ============ [UX-T49] scroll restoration (docs/spec-ux-i22-scroll.md §10) ============
   Хелпер scrollKeeper: снимок позиции ДО перестройки DOM, восстановление ПОСЛЕ по ключу
   вида (как wkScroll у календаря). Клик по элементу ниже фолда — через evaluate(el.click()):
   автоскролл Playwright сдвинул бы страницу ДО снимка и сломал сценарий. */
test.describe('[UX-T49] scroll restoration', function () {

    /* 24 завершённые тренировки за 24 дня — список Истории гарантированно длиннее вьюпорта */
    async function seedLongHistory(request) {
        const now = new Date();
        const wos = [];
        for (let i = 1; i <= 24; i++) {
            const day = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
            wos.push(doneWorkout(i, day, EX, '100', 3));
        }
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            rev: 1, nextId: 25, del: [], workouts: wos } } });
    }
    async function expectScrollNear(page, expected, tol) {
        await expect.poll(async function () {
            const y = await page.evaluate(function () { return window.scrollY; });
            return Math.abs(y - expected);
        }, { timeout: 5000 }).toBeLessThanOrEqual(tol);
    }
    async function pageScrollTo(page, y) {
        await page.evaluate(function (y) { window.scrollTo(0, y); }, y);
        await expectScrollNear(page, y, 1); /* дождались фактической позиции */
    }
    /* клик без scroll-into-view: позиция страницы к моменту снимка не меняется */
    async function jsClick(loc) {
        await loc.first().evaluate(function (el) { el.click(); });
    }

    test('история: возврат из карточки — позиция списка восстановлена', async ({ page, request }) => {
        await seedLongHistory(request);
        await openApp(page);
        await pageScrollTo(page, 700);
        await jsClick(page.locator('.pcard:not(.glow)'));
        await expect(page.locator('.backbar')).toBeVisible({ timeout: 5000 });
        await expectScrollNear(page, 0, 1); /* вход в карточку — всегда верх */
        await page.locator('.backbar [data-act="closeHistory"]').click(); /* [UX-T49] выход из карточки — нижний backbar; верхняя «←» топбара — отдельный акт [единообразие] */
        await expect(page.locator('.pcard:not(.glow)').first()).toBeVisible({ timeout: 5000 });
        await expectScrollNear(page, 700, 3); /* возврат — точная позиция ухода */
    });

    /* [единообразие] тот же сценарий с выходом через ВЕРХНЮЮ «←» топбара: на карточке
       тренировки это та же data-act="closeHistory" — скролл-ресторация обязана работать
       так же, как у нижнего backbar */
    test('история: выход из карточки верхней «←» топбара — позиция списка восстановлена', async ({ page, request }) => {
        await seedLongHistory(request);
        await openApp(page);
        await pageScrollTo(page, 700);
        await jsClick(page.locator('.pcard:not(.glow)'));
        await expect(page.locator('.backbar')).toBeVisible({ timeout: 5000 });
        await expectScrollNear(page, 0, 1); /* вход в карточку — всегда верх */
        await page.locator('.topbar [aria-label="Назад"]').click(); /* [UX-T49] верхняя стрелка топбара — тот же closeHistory */
        await expect(page.locator('.pcard:not(.glow)').first()).toBeVisible({ timeout: 5000 });
        await expectScrollNear(page, 700, 3); /* возврат — точная позиция ухода */
    });

    test('техника: возврат из карточки упражнения — позиция восстановлена', async ({ page, request }) => {
        await seedLongHistory(request);
        await openApp(page);
        await page.locator('.nav .nbtn[data-act="switchTab"][data-a="tech"]').click();
        await expect(page.locator('#techList .excard').first()).toBeVisible({ timeout: 5000 });
        await pageScrollTo(page, 600);
        await jsClick(page.locator('#techList .excard'));
        await expect(page.locator('[data-act="techBack"]').first()).toBeVisible({ timeout: 5000 });
        await expectScrollNear(page, 0, 1);
        await page.locator('[data-act="techBack"]').click();
        await expect(page.locator('#techList .excard').first()).toBeVisible({ timeout: 5000 });
        /* lazy-визуалы карточек могут догрузиться после восстановления — допускаем дрейф (спека §7) */
        await expectScrollNear(page, 600, 40);
    });

    test('техника: смена чипа — верх; возврат к прежнему чипу — восстановление', async ({ page, request }) => {
        await seedLongHistory(request);
        await openApp(page);
        await page.locator('.nav .nbtn[data-act="switchTab"][data-a="tech"]').click();
        await expect(page.locator('#techList .excard').first()).toBeVisible({ timeout: 5000 });
        await pageScrollTo(page, 600);
        /* чипы разделов выше фолда — клик без автоскролла */
        await jsClick(page.locator('[data-act="techSection"]', { hasText: '★ Любимые' }));
        await expect(page.locator('[data-act="techSection"][data-a="fav"].on')).toBeVisible({ timeout: 5000 });
        await expectScrollNear(page, 0, 1); /* новый набор фильтров — список сверху */
        await jsClick(page.locator('[data-act="techSection"]', { hasText: 'Все' }));
        await expect(page.locator('#techList .excard').first()).toBeVisible({ timeout: 5000 });
        await expectScrollNear(page, 600, 40); /* снапшот под старым ключом жив */
    });

    test('вкладка туда-сюда: История → Статистика → История — позиция восстановлена', async ({ page, request }) => {
        await seedLongHistory(request);
        await openApp(page);
        await pageScrollTo(page, 500);
        await page.locator('.nav .nbtn[data-act="switchTab"][data-a="stats"]').click();
        await expect(page.locator('.statgrid')).toBeVisible({ timeout: 5000 });
        await expectScrollNear(page, 0, 1); /* новая вкладка — с верха */
        await page.locator('.nav .nbtn[data-act="switchTab"][data-a="history"]').click();
        await expect(page.locator('.pcard:not(.glow)').first()).toBeVisible({ timeout: 5000 });
        await expectScrollNear(page, 500, 3); /* меж-вкладочная память: снапшоты не чистятся */
    });

    test('статистика: смена периода — верх; возврат к периоду — восстановление', async ({ page, request }) => {
        await seedLongHistory(request);
        await openApp(page);
        await page.locator('.nav .nbtn[data-act="switchTab"][data-a="stats"]').click();
        await expect(page.locator('.statgrid')).toBeVisible({ timeout: 5000 });
        await pageScrollTo(page, 300);
        await jsClick(page.locator('[data-act="statsPeriod"]', { hasText: 'Год' }));
        await expect(page.locator('.statgrid')).toBeVisible({ timeout: 5000 });
        await expectScrollNear(page, 0, 1); /* решение владельца: смена периода = верх */
        await jsClick(page.locator('[data-act="statsPeriod"]', { hasText: 'Месяц' }));
        await expect(page.locator('.statgrid')).toBeVisible({ timeout: 5000 });
        await expectScrollNear(page, 300, 5);
    });

    test('настройки туда-сюда: выход возвращает позицию вкладки-источника', async ({ page, request }) => {
        await seedLongHistory(request);
        await openApp(page);
        await pageScrollTo(page, 400);
        await jsClick(page.locator('[data-act="openSettings"]'));
        await expect(page.locator('[data-act="closeSettings"]').first()).toBeVisible({ timeout: 5000 });
        await expectScrollNear(page, 0, 1); /* вход в Настройки — верх */
        await page.locator('[data-act="closeSettings"]').first().click();
        await expect(page.locator('.pcard:not(.glow)').first()).toBeVisible({ timeout: 5000 });
        await expectScrollNear(page, 400, 3); /* фикс §3.11: не сброс наверх, а позиция ухода */
    });

    test('мастер целей: шаги с верха; выход возвращает позицию вкладки', async ({ page, request }) => {
        await seedLongHistory(request);
        await openApp(page);
        await page.locator('.nav .nbtn[data-act="switchTab"][data-a="stats"]').click();
        await expect(page.locator('.statgrid')).toBeVisible({ timeout: 5000 });
        await pageScrollTo(page, 300);
        await page.locator('[data-act="openGoals"]').click();
        await expect(page.locator('[data-act="goalNew"]').first()).toBeVisible({ timeout: 5000 });
        await expectScrollNear(page, 0, 1); /* подэкран «Цели» — верх, не скролл Статистики */
        await page.locator('[data-act="goalNew"]').first().click();
        await expect(page.locator('[data-act="gwType"][data-a="1"]')).toBeVisible({ timeout: 5000 });
        await expectScrollNear(page, 0, 1); /* шаг 1 — верх (старый scrollTo сохранён) */
        await page.locator('[data-act="gwType"][data-a="1"]').click();
        await expect(page.locator('#gwList .frow').first()).toBeVisible({ timeout: 5000 });
        await page.locator('#gwList .frow').first().click();
        await expect(page.locator('#gwTarget')).toBeVisible({ timeout: 5000 });
        await expectScrollNear(page, 0, 1); /* шаг «значение» — верх */
        await page.locator('#gwTarget').fill('300'); /* > e1RM (~130) — сразу «Далее», без предупреждения */
        await page.locator('[data-act="gwTargetNext"]').click();
        await expect(page.locator('[data-act="gwPeriod"]').first()).toBeVisible({ timeout: 5000 });
        await expectScrollNear(page, 0, 1); /* шаг «срок» — верх */
        await page.locator('[data-act="gwBack"]').first().click();
        await expect(page.locator('#gwTarget')).toBeVisible({ timeout: 5000 });
        await expectScrollNear(page, 0, 1); /* шаг назад — тоже верх (без регрессии) */
        /* выход из мастера: шаги до 1-го, «←» закрывает — вкладка-источник восстановлена */
        await page.locator('[data-act="gwBack"]').first().click();
        await expect(page.locator('#gwList .frow').first()).toBeVisible({ timeout: 5000 });
        await page.locator('[data-act="gwBack"]').first().click();
        await expect(page.locator('[data-act="gwType"][data-a="1"]')).toBeVisible({ timeout: 5000 });
        await page.locator('[data-act="gwBack"]').first().click(); /* шаг 1 «←» — выход из мастера */
        await expect(page.locator('[data-act="goalNew"]').first()).toBeVisible({ timeout: 5000 });
        await expectScrollNear(page, 0, 1);
        await page.locator('[data-act="closeGoals"]').first().click();
        await expect(page.locator('.statgrid')).toBeVisible({ timeout: 5000 });
        await expectScrollNear(page, 300, 3); /* фикс §3.11/§3.14: Статистика на позиции ухода */
    });

    test('перезагрузка страницы: все вкладки с верха (хранилище в памяти)', async ({ page, request }) => {
        await seedLongHistory(request);
        await openApp(page);
        await pageScrollTo(page, 600);
        await page.reload();
        await openApp(page);
        await expectScrollNear(page, 0, 1); /* честный верх: снапшоты не переживают reload */
    });

    test('завершение тренировки: список Истории с верха (инвалидация снапшотов)', async ({ page, request }) => {
        const now = new Date();
        const today = isoDate(now);
        const wos = [];
        for (let i = 1; i <= 24; i++) {
            const day = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
            wos.push(doneWorkout(i, day, EX, '100', 3));
        }
        /* активная тренировка с записанным подходом — превью-карточка в Истории */
        wos.unshift({ id: 99, date: today, started: today + 'T09:00:00', ended: '', finished: false, title: '', nutrition: '',
            exercises: [{ name: EX, st: today + 'T09:01:00', en: '', sets: [{ w: '50', s: 5, r: '8', t: today + 'T09:02:00' }] }] });
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            rev: 1, nextId: 100, del: [], workouts: wos } } });
        await openApp(page);
        await expect(page.locator('.pcard.glow').first()).toBeVisible({ timeout: 5000 });
        await pageScrollTo(page, 600);
        await jsClick(page.locator('.pcard.glow'));
        await expect(page.locator('[data-act="finishWorkout"]')).toBeVisible({ timeout: 5000 });
        await expectScrollNear(page, 0, 1); /* карточка — верх */
        await page.locator('[data-act="finishWorkout"]').click();
        await expect(page.locator('.toast.show')).toBeVisible({ timeout: 5000 });
        /* [FIT-T1] решение 1-А: после завершения остаёмся в карточке — backbar завершённого
           набора (🗑/↻/←), скачка скролла нет; «Назад» — история с верха (позиции долой) */
        await expect(page.locator('.backbar', { hasText: 'Повторить' })).toBeVisible({ timeout: 5000 });
        await expectScrollNear(page, 0, 1);
        await page.locator('.backbar [data-act="closeHistory"]').click();
        await expect(page.locator('.pcard').first()).toBeVisible({ timeout: 5000 });
        await expectScrollNear(page, 0, 1);
    });

    test('живой поиск §10.7: карточка туда-сюда — позиция восстановлена под ключом с q=', async ({ page, request }) => {
        await seedLongHistory(request);
        await openApp(page);
        await page.locator('.nav .nbtn[data-act="switchTab"][data-a="tech"]').click();
        await expect(page.locator('#techList .excard').first()).toBeVisible({ timeout: 5000 });
        /* fill диспатчит input — живой поиск фильтрует список (§4.4: SKEEP.cur следует за q) */
        await page.locator('#techQ').fill('жим');
        await expect(page.locator('#techList .excard').first()).toContainText('Жим штанги лёжа');
        await expect(page.locator('#techList .excard', { hasText: 'Приседания со штангой' })).toHaveCount(0);
        await pageScrollTo(page, 300);
        await jsClick(page.locator('#techList .excard'));
        await expect(page.locator('[data-act="techBack"]').first()).toBeVisible({ timeout: 5000 });
        await expectScrollNear(page, 0, 1); /* карточка — верх */
        await page.locator('[data-act="techBack"]').click();
        await expect(page.locator('#techList .excard').first()).toBeVisible({ timeout: 5000 });
        /* список по-прежнему отфильтрован, позиция — под НОВЫМ ключом (с q=жим), не под старым */
        await expect(page.locator('#techList .excard', { hasText: 'Приседания со штангой' })).toHaveCount(0);
        await expectScrollNear(page, 300, 40); /* lazy-визуалы карточек — допуск (спека §7) */
    });

    test('живой поиск: уход-возврат хранит фильтр и позицию (q= в ключе); смена вкладки — сброс [UX-T20]', async ({ page, request }) => {
        await seedLongHistory(request);
        await openApp(page);
        await page.locator('.nav .nbtn[data-act="switchTab"][data-a="tech"]').click();
        await expect(page.locator('#techList .excard').first()).toBeVisible({ timeout: 5000 });
        await page.locator('#techQ').fill('жим');
        await expect(page.locator('#techList .excard', { hasText: 'Приседания со штангой' })).toHaveCount(0);
        await pageScrollTo(page, 300);
        /* подэкран туда-сюда: q живёт в состоянии TECH — возврат под ключом с q= */
        await jsClick(page.locator('.topbar [data-act="openSettings"]'));
        await expect(page.locator('[data-act="closeSettings"]').first()).toBeVisible({ timeout: 5000 });
        await expectScrollNear(page, 0, 1); /* Настройки — верх */
        await page.locator('[data-act="closeSettings"]').first().click();
        await expect(page.locator('#techList .excard').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#techList .excard', { hasText: 'Приседания со штангой' })).toHaveCount(0);
        await expectScrollNear(page, 300, 40); /* позиция восстановлена корректно */
        /* нижнее меню — другой механизм: вход на Технику сбрасывает поиск [UX-T20]:
           свежий ключ без q → полный список С ВЕРХА, устаревший снапшот под q-ключом
           не применяется (без синхронизации §4.4 сюда приехал бы y=300 полного списка) */
        await page.locator('.nav .nbtn[data-act="switchTab"][data-a="stats"]').click();
        await expect(page.locator('.statgrid')).toBeVisible({ timeout: 5000 });
        await page.locator('.nav .nbtn[data-act="switchTab"][data-a="tech"]').click();
        await expect(page.locator('#techList .excard', { hasText: 'Приседания со штангой' }).first()).toBeVisible({ timeout: 5000 });
        await expectScrollNear(page, 0, 1);
    });

    test('Настройки из Календаря: вход — верх, выход — позиция календаря восстановлена', async ({ page, request }) => {
        /* по живому прогону ревьюера: годовой вид, cal на y=77; настройки поверх календаря
           получали ключ cal:… — same-key skip блокировал верх, closeSettings перезаписывал
           снапшот календаря. scrollKey теперь берёт приоритет из navScreen(): settings > cal */
        await seedLongHistory(request);
        await openApp(page);
        /* 390x640: годовой вид выше вьюпорта на всех проектах (pixel7 не скроллится) */
        await page.setViewportSize({ width: 390, height: 640 });
        await page.locator('.topbar [data-act="openCal"]').click();
        await expect(page.locator('.card.cal')).toBeVisible({ timeout: 5000 });
        await jsClick(page.locator('.topbar [data-act="openCalPicker"]'));
        await expect(page.locator('.modal.open')).toBeVisible({ timeout: 5000 });
        await page.locator('.modal.open .pli', { hasText: 'Год' }).click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await expect(page.locator('.cal-title')).toContainText(String(new Date().getFullYear()));
        /* годовой вид чуть выше вьюпорта: целимся в y=77 (прогон ревьюера), но не глубже max */
        const y = await page.evaluate(function () {
            const max = document.documentElement.scrollHeight - window.innerHeight;
            window.scrollTo(0, Math.min(77, max));
            return window.scrollY;
        });
        expect(y).toBeGreaterThan(0); /* страница скроллится — проверка восстановления осмысленна */
        await expectScrollNear(page, y, 1);
        /* ⚙ поверх календаря: calOpen остаётся взведённым — ключ должен стать 'settings' */
        await jsClick(page.locator('.topbar [data-act="openSettings"]'));
        await expect(page.locator('[data-act="closeSettings"]').first()).toBeVisible({ timeout: 5000 });
        await expectScrollNear(page, 0, 1); /* верх, а не y (ранее same-key skip блокировал) */
        await pageScrollTo(page, 150); /* скролл внутри Настроек: снапшот календаря не должен перезаписаться */
        await page.locator('[data-act="closeSettings"]').first().click();
        await expect(page.locator('.card.cal')).toBeVisible({ timeout: 5000 });
        await expectScrollNear(page, y, 3); /* снапшот календаря не перезаписан скроллом Настроек */
    });
});

/* ============ [ONB-T10] импорт из Strong (docs/spec-onb-s6-import.md, Э1–Э9) ============ */
test.describe('[ONB-T10] импорт из Strong', function () {

    const HEAD = 'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Time,Weight Unit\n';

    /* выгрузка на 2 тренировки: схлопывание 60×8×3, известное + английское упражнения */
    function csvTwo() {
        return HEAD +
            '2024-11-18 07:00,Full Gym,1h 6m 25s,Жим штанги лёжа,2,60,8,,,kg\n' +
            '2024-11-18 07:00,Full Gym,1h 6m 25s,Жим штанги лёжа,1,60,8,,,kg\n' +
            '2024-11-18 07:00,Full Gym,1h 6m 25s,Жим штанги лёжа,3,60,8,,,kg\n' +
            '2024-11-18 07:00,Full Gym,1h 6m 25s,Bench Press (Barbell),1,62.5,10,,,kg\n' +
            '2024-11-19 18:30,Full Gym,35,Lat Pulldown,1,50,12,,,kg\n';
    }
    /* вход в флоу из плашки пустой Истории (Э9) */
    async function openImportFromPlaque(page) {
        await expect(page.locator('.imp-cta')).toBeVisible({ timeout: 5000 });
        await page.locator('.imp-cta [data-act="openImport"]').click();
        await expect(page.locator('.topbar .tb-title')).toHaveText('📦 Переезд из Strong', { timeout: 5000 });
    }
    async function pickCsv(page, name, csv) {
        await page.locator('#impFile').setInputFiles([{ name: name, mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') }]);
    }

    test('happy path: плашка → выбор файла → предпросмотр → импорт → результат → история', async ({ page, request }) => {
        await openApp(page);
        await openImportFromPlaque(page);
        /* Э2: сегмент кг по умолчанию, инструкция раскрыта при первом входе, приватность */
        await expect(page.locator('.unitseg .seg-btn', { hasText: 'кг' })).toHaveClass(/on/);
        await expect(page.locator('details.acc')).toHaveAttribute('open');
        await expect(page.locator('[data-act="impPick"]')).toContainText('Выбрать файл CSV');
        await expect(page.locator('.card')).toContainText('никуда не отправляется');
        await pickCsv(page, 'strong.csv', csvTwo());
        /* Э4: сводка предпросмотра + раскрытие «не из каталога» */
        await expect(page.locator('.bignum')).toContainText('2', { timeout: 5000 });
        await expect(page.locator('details.plain summary')).toContainText('2 упражнения не из каталога');
        await page.locator('details.plain summary').click();
        await expect(page.locator('details.plain .ddlist')).toContainText('Bench Press (Barbell)');
        await expect(page.locator('details.plain .ddlist')).toContainText('1 тренировка');
        /* Э6: подтверждение и результат */
        await expect(page.locator('[data-act="impConfirm"]')).toContainText('Импортировать 2 тренировки');
        await page.locator('[data-act="impConfirm"]').click();
        await expect(page.locator('.resttl')).toContainText('Готово — 2 тренировки в дневнике!', { timeout: 10000 });
        await expect(page.locator('.krow', { hasText: 'Период' })).toContainText('18.11.2024 — 19.11.2024');
        await page.locator('[data-act="impDone"]').click();
        /* история заполнена, плашка исчезла (она только для пустой) */
        await expect(page.locator('.pcard').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.imp-cta')).toHaveCount(0);
        /* состояние сервера: finished, схлопывание, title, nutrition пуст, id назначены */
        const st = await (await request.get('/api/state')).json();
        expect(st.workouts.length).toBe(2);
        const w1 = st.workouts.find(function (w) { return w.date === '2024-11-18'; });
        expect(w1.finished).toBe(true);
        expect(w1.title).toBe('Full Gym');
        expect(w1.nutrition).toBe('');
        expect(w1.started).toBe('2024-11-18T07:00:00');
        expect(w1.ended).toBe('2024-11-18T08:06:25');
        const bench = w1.exercises.find(function (e) { return e.name === 'Жим штанги лёжа'; });
        expect(bench.sets.length).toBe(1);
        expect(bench.sets[0].w).toBe('60');
        expect(bench.sets[0].s).toBe(3);
        expect(bench.sets[0].r).toBe('8');
        /* ids из G.nextId, без коллизий */
        expect(w1.id).toBeGreaterThan(0);
    });

    test('точка входа в Настройках (Э1): карточка «Данные», пилюля «новое», повторный вход', async ({ page }) => {
        await openApp(page);
        await page.locator('[data-act="openSettings"]').first().click();
        await expect(page.locator('.card.impdata')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.card.impdata .newpill')).toBeVisible(); /* первый вход */
        await page.locator('.card.impdata .arow').click();
        await expect(page.locator('.topbar .tb-title')).toHaveText('📦 Переезд из Strong');
        /* «←» из флоу возвращает в Настройки; пилюля погасла (gymImportSeen) */
        await page.locator('.topbar [data-act="impBack"]').click();
        await expect(page.locator('.card.impdata')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.card.impdata .newpill')).toHaveCount(0);
        /* повторный вход — с шага выбора, аккордеон инструкции закрыт */
        await page.locator('.card.impdata .arow').click();
        await expect(page.locator('[data-act="impPick"]')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('details.acc')).not.toHaveAttribute('open');
    });

    test('чужой CSV (Э7): «Не похоже на выгрузку Strong», повторный выбор файла спасает', async ({ page }) => {
        await openApp(page);
        await openImportFromPlaque(page);
        await pickCsv(page, 'other.csv', 'name,amount\nМолоко,2\n');
        await expect(page.locator('.resicon.bad')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.resttl')).toHaveText('Не похоже на выгрузку Strong');
        await expect(page.locator('.card')).toContainText('нет колонок Strong');
        /* «Выбрать другой файл» → валидный CSV → предпросмотр */
        await pickCsv(page, 'strong.csv', csvTwo());
        await expect(page.locator('.bignum')).toContainText('2', { timeout: 5000 });
    });

    test('пустой файл (Э8): только заголовки — «В файле нет тренировок»', async ({ page }) => {
        await openApp(page);
        await openImportFromPlaque(page);
        await pickCsv(page, 'empty.csv', HEAD);
        await expect(page.locator('.resttl')).toHaveText('В файле нет тренировок', { timeout: 5000 });
        await expect(page.locator('.card')).toContainText('только заголовки');
    });

    test('фунты (Э2): сегмент lb — веса пересчитаны в кг в состоянии', async ({ page, request }) => {
        await openApp(page);
        await openImportFromPlaque(page);
        await page.locator('.unitseg .seg-btn', { hasText: 'фунты' }).click();
        await expect(page.locator('.unitseg .seg-btn', { hasText: 'фунты' })).toHaveClass(/on/);
        const csv = HEAD +
            '2024-11-18 07:00,Gym,,Приседания со штангой,1,100,5,,,lbs\n' +
            '2024-11-18 07:00,Gym,,Приседания со штангой,2,100,5,,,lbs\n';
        await pickCsv(page, 'lbs.csv', csv);
        await page.locator('[data-act="impConfirm"]').click();
        await expect(page.locator('.resttl')).toContainText('Готово', { timeout: 10000 });
        const st = await (await request.get('/api/state')).json();
        const sets = st.workouts[0].exercises[0].sets;
        /* 100 lb = 45.36 кг → округление до 0.5 → 45.5; два подхода схлопнулись */
        expect(sets.length).toBe(1);
        expect(sets[0].w).toBe('45.5');
        expect(sets[0].s).toBe(2);
    });

    test('совпадение дат (Э5): жёлтая плашка в предпросмотре, обе тренировки остаются', async ({ page, request }) => {
        const today = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [], workouts: [doneWorkout(1, today, EX, '100', 3)] } } });
        await openApp(page);
        /* история непуста — плашки нет, вход через Настройки */
        await expect(page.locator('.imp-cta')).toHaveCount(0);
        await page.locator('[data-act="openSettings"]').first().click();
        await page.locator('.card.impdata .arow').click();
        const csv = HEAD +
            today + ' 07:00,Full Gym,,Жим штанги лёжа,1,90,8,,,kg\n' +
            '2024-05-01 10:00,Full Gym,,Жим штанги лёжа,1,90,8,,,kg\n';
        await pickCsv(page, 'dup.csv', csv);
        await expect(page.locator('details.warn summary')).toContainText('1 дата совпадает с дневником', { timeout: 5000 });
        await page.locator('details.warn summary').click();
        await expect(page.locator('details.warn .ddlist')).toContainText('уже есть тренировка');
        await page.locator('[data-act="impConfirm"]').click();
        await expect(page.locator('.resttl')).toContainText('Готово — 2 тренировки в дневнике!', { timeout: 10000 });
        await page.locator('[data-act="impDone"]').click();
        const st = await (await request.get('/api/state')).json();
        expect(st.workouts.length).toBe(3); /* «оба»: своя за сегодня + 2 импортированные */
        expect(st.workouts.filter(function (w) { return w.date === today; }).length).toBe(2);
    });

    test('кардио-пропуск (Э6): строка с Distance/Time без Reps — с причиной в результате', async ({ page, request }) => {
        await openApp(page);
        await openImportFromPlaque(page);
        const csv = HEAD +
            '2024-11-18 07:00,Gym,,Жим штанги лёжа,1,60,8,,,kg\n' +
            '2024-11-18 07:00,Gym,,Беговая дорожка,2,,,,5.5,\n' +
            '2024-11-18 07:00,Gym,,Скакалка,3,,,,,25:00\n';
        await pickCsv(page, 'cardio.csv', csv);
        await page.locator('[data-act="impConfirm"]').click();
        await expect(page.locator('.resttl')).toContainText('Готово — 1 тренировка в дневнике!', { timeout: 10000 });
        await expect(page.locator('details.warn summary')).toContainText('Не перенеслось: 2 строки');
        await expect(page.locator('details.warn .ddlist')).toContainText('кардио-подход (время/дистанция) не переносится');
        const st = await (await request.get('/api/state')).json();
        expect(st.workouts[0].exercises.length).toBe(1);
        expect(st.workouts[0].exercises[0].name).toBe('Жим штанги лёжа');
    });

    test('undo (Э6): «Отменить импорт» — дневник как до импорта, снова шаг 1', async ({ page, request }) => {
        await openApp(page);
        await openImportFromPlaque(page);
        await pickCsv(page, 'strong.csv', csvTwo());
        await page.locator('[data-act="impConfirm"]').click();
        await expect(page.locator('.resttl')).toContainText('Готово', { timeout: 10000 });
        const saved = page.waitForResponse(function (r) {
            return r.url().indexOf('/api/save') >= 0 && r.request().method() === 'POST';
        });
        await page.locator('[data-act="impUndo"]').click();
        await saved; /* undo докатывается до сервера */
        /* возврат к шагу 1 (§4.4) */
        await expect(page.locator('[data-act="impPick"]')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.bignum')).toHaveCount(0);
        const st = await (await request.get('/api/state')).json();
        expect(st.workouts.length).toBe(0);
        /* «←» — пустая история, плашка на месте */
        await page.locator('.topbar [data-act="impBack"]').click();
        await expect(page.locator('.imp-cta')).toBeVisible({ timeout: 5000 });
    });

    test('навигация (§4): «←» с шага выбора возвращает на исходный экран, свайп-стек не ломается', async ({ page }) => {
        await openApp(page);
        await page.locator('[data-act="openSettings"]').first().click();
        await expect(page.locator('.card.impdata')).toBeVisible({ timeout: 5000 });
        await page.locator('.card.impdata .arow').click();
        await expect(page.locator('.topbar .tb-title')).toHaveText('📦 Переезд из Strong');
        await page.locator('.topbar [data-act="impBack"]').click();
        /* возврат именно в Настройки (подэкран, из которого открыли) */
        await expect(page.locator('.card.impdata')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.topbar .tb-title')).toContainText('Настройки');
        /* тап по нижнему меню закрывает флоу и уводит на вкладку (switchTab-семантика) */
        await page.locator('.card.impdata .arow').click();
        await expect(page.locator('.topbar .tb-title')).toHaveText('📦 Переезд из Strong');
        await page.locator('.nav .nbtn[data-act="switchTab"][data-a="stats"]').click();
        await expect(page.locator('.topbar .tb-title')).toContainText('Статистика', { timeout: 5000 });
    });

    /* ---------- досдача 564edae + дыры ревью [ONB-T10] (In Test, 23.11.2026) ---------- */

    /* синтетический свайп от края (копия helper [UX-T42]): старт x0, смещение dx по горизонтали */
    async function swipeEdge(page, x0, dx) {
        await page.evaluate(function (o) {
            const el = document.getElementById('app');
            const mkT = function (x, y) { return { identifier: 1, target: el, clientX: x, clientY: y }; };
            const mkEv = function (type, touches, changed) {
                const ev = new Event(type, { bubbles: true, cancelable: true });
                Object.defineProperty(ev, 'touches', { value: touches });
                Object.defineProperty(ev, 'targetTouches', { value: touches });
                Object.defineProperty(ev, 'changedTouches', { value: changed });
                Object.defineProperty(ev, 'target', { value: el });
                return ev;
            };
            el.dispatchEvent(mkEv('touchstart', [mkT(o.x0, 300)], [mkT(o.x0, 300)]));
            el.dispatchEvent(mkEv('touchmove', [mkT(o.x0 + o.dx / 2, 300)], [mkT(o.x0 + o.dx / 2, 300)]));
            el.dispatchEvent(mkEv('touchend', [], [mkT(o.x0 + o.dx, 300)]));
        }, { x0: x0, dx: dx });
    }
    /* 320px: на экране нет горизонтального скролла документа */
    async function noHScroll(page, label) {
        const m = await page.evaluate(function () {
            return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
        });
        if (m.sw > m.cw + 1) throw new Error(label + ': горизонтальный скролл на 320px — scrollWidth ' + m.sw + ' > clientWidth ' + m.cw);
    }
    /* выгрузка на 12 тренировок × 3 упражнения × 300 одинаковых подходов ≈ 0.6 МБ —
       выше порога кадра «Читаем файл…» (200 КБ); повторяющиеся подходы схлопнутся */
    function csvBig() {
        const names = ['Жим штанги лёжа', 'Bench Press (Barbell)', 'Lat Pulldown'];
        const rows = [HEAD];
        for (let d = 0; d < 12; d++) {
            const day = '2023-03-' + String(1 + d).padStart(2, '0');
            for (const name of names) {
                for (let k = 1; k <= 300; k++) {
                    rows.push(day + ' 07:00,Full Gym,1h,' + name + ',' + k + ',60,8,,,kg\n');
                }
            }
        }
        return rows.join('');
    }
    /* предпросмотр для 320px: известное + ДЛИННОЕ чужое имя — стресс переноса строк в раскрытии */
    function csv320() {
        return HEAD +
            '2024-11-18 07:00,Full Gym,1h,Жим штанги лёжа,1,60,8,,,kg\n' +
            '2024-11-18 07:00,Full Gym,1h,Dumbbell Incline Bench Press Two Dumbbells Variation (Barbell),1,22.5,12,,,kg\n';
    }

    test('кадр Э3 «Читаем файл…» для файла >200 КБ: честный кадр без ✓, после разбора исчезает (564edae)', async ({ page }) => {
        await openApp(page);
        await openImportFromPlaque(page);
        const csv = csvBig();
        if (Buffer.byteLength(csv, 'utf8') <= 200 * 1024) throw new Error('фикстура меньше порога 200 КБ: ' + Buffer.byteLength(csv, 'utf8'));
        await pickCsv(page, 'big.csv', csv);
        /* кадр парсинга появился сразу и ЧЕСТНЫЙ: «Читаем файл…», имя/размер файла, БЕЗ преждевременных «✓» */
        await expect(page.locator('.imp-busy')).toBeVisible({ timeout: 2000 });
        await expect(page.locator('.imp-busy')).toContainText('Читаем файл…');
        await expect(page.locator('.imp-busy .filetag')).toContainText('big.csv');
        await expect(page.locator('.imp-busy .filetag')).toContainText('КБ');
        const frameText = (await page.locator('.imp-busy').textContent()) || '';
        if (frameText.indexOf('✓') >= 0) throw new Error('в кадре парсинга преждевременная «✓»: ' + frameText);
        /* разбор дошёл до предпросмотра — кадр исчез (не завис) */
        await expect(page.locator('.bignum')).toContainText('12', { timeout: 10000 });
        await expect(page.locator('.imp-busy')).toHaveCount(0);
    });

    test('файл >15 МБ (§4.5): лимит-заглушка сразу, без кадра парсинга; другой файл проходит', async ({ page }) => {
        await openApp(page);
        await openImportFromPlaque(page);
        /* контент неважен: проверка размера до чтения (§4.5) */
        await pickCsv(page, 'huge.csv', Buffer.alloc(15 * 1024 * 1024 + 100, 0x61).toString('binary'));
        await expect(page.locator('.resttl')).toHaveText('Файл слишком большой', { timeout: 5000 });
        await expect(page.locator('.card')).toContainText('до 15 МБ');
        await expect(page.locator('.imp-busy')).toHaveCount(0); /* кадр парсинга не показывался */
        /* «Выбрать другой файл» — путь восстановления: валидный CSV → предпросмотр */
        await pickCsv(page, 'strong.csv', csvTwo());
        await expect(page.locator('.bignum')).toContainText('2', { timeout: 5000 });
        await expect(page.locator('.resttl')).toHaveCount(0);
    });

    test('navForward-стрип: «назад» из флоу и после результата — свайп «вперёд» импорт не возвращает', async ({ page }) => {
        test.skip(!test.info().project.use.hasTouch, 'свайпы: только touch-проекты (android360, iphone13, pixel7)');
        await openApp(page);
        const vw = await page.evaluate(function () { return document.documentElement.clientWidth; });
        await page.locator('[data-act="openSettings"]').first().click();
        await page.locator('.card.impdata .arow').click();
        await expect(page.locator('.topbar .tb-title')).toHaveText('📦 Переезд из Strong', { timeout: 5000 });
        /* назад с шага выбора (свайп от левого края) → Настройки; «вперёд» — импорт НЕ возвращается */
        await swipeEdge(page, 10, 120);
        await expect(page.locator('.card.impdata')).toBeVisible({ timeout: 5000 });
        await swipeEdge(page, vw - 10, -120);
        await expect(page.locator('.topbar .tb-title')).toContainText('Настройки', { timeout: 5000 });
        await expect(page.locator('[data-act="impPick"]')).toHaveCount(0);
        /* повторный вход, довели до результата, назад свайпом → «вперёд» тоже не вернёт флоу
           (риск: случайный свайп по результату с «Отменить импорт» = повторный импорт) */
        await page.locator('.card.impdata .arow').click();
        await expect(page.locator('[data-act="impPick"]')).toBeVisible({ timeout: 5000 });
        await pickCsv(page, 'strong.csv', csvTwo());
        await expect(page.locator('.bignum')).toContainText('2', { timeout: 5000 });
        await page.locator('[data-act="impConfirm"]').click();
        await expect(page.locator('.resttl')).toContainText('Готово — 2 тренировки в дневнике!', { timeout: 10000 });
        await swipeEdge(page, 10, 120);
        await expect(page.locator('.card.impdata')).toBeVisible({ timeout: 5000 });
        await swipeEdge(page, vw - 10, -120);
        await expect(page.locator('.topbar .tb-title')).toContainText('Настройки', { timeout: 5000 });
        await expect(page.locator('.resttl')).toHaveCount(0);
        await expect(page.locator('[data-act="impUndo"]')).toHaveCount(0);
    });

    test('undo-цикл: после «Отменить импорт» История пуста и плашка вернулась; повторный импорт тем же файлом работает', async ({ page, request }) => {
        await openApp(page);
        await page.locator('[data-act="openSettings"]').first().click();
        await page.locator('.card.impdata .arow').click();
        await pickCsv(page, 'strong.csv', csvTwo());
        await expect(page.locator('.bignum')).toContainText('2', { timeout: 5000 });
        await page.locator('[data-act="impConfirm"]').click();
        await expect(page.locator('.resttl')).toContainText('Готово — 2 тренировки в дневнике!', { timeout: 10000 });
        const undoSaved = page.waitForResponse(function (r) {
            return r.url().indexOf('/api/save') >= 0 && r.request().method() === 'POST';
        });
        await page.locator('[data-act="impUndo"]').click();
        await expect(page.locator('[data-act="impPick"]')).toBeVisible({ timeout: 5000 }); /* снова шаг 1 */
        await undoSaved;
        const st = await (await request.get('/api/state')).json();
        expect(st.workouts.length).toBe(0);
        expect((st.del || []).length).toBe(2); /* томстоуны: undo не воскресит серверные копии */
        /* назад → Настройки → закрыть: История ПУСТА (герой), плашка импорта вернулась */
        await page.locator('.topbar [data-act="impBack"]').click();
        await expect(page.locator('.card.impdata')).toBeVisible({ timeout: 5000 });
        await page.locator('.topbar [data-act="closeSettings"]').first().click();
        await expect(page.locator('#app .hero', { hasText: 'Пока пусто' })).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.pcard')).toHaveCount(0);
        await expect(page.locator('.imp-cta')).toBeVisible({ timeout: 5000 });
        /* повторный импорт ТЕМ ЖЕ файлом — из плашки, до результата и Истории */
        await page.locator('.imp-cta [data-act="openImport"]').click();
        await expect(page.locator('.topbar .tb-title')).toHaveText('📦 Переезд из Strong', { timeout: 5000 });
        await pickCsv(page, 'strong.csv', csvTwo());
        await expect(page.locator('.bignum')).toContainText('2', { timeout: 5000 });
        await page.locator('[data-act="impConfirm"]').click();
        await expect(page.locator('.resttl')).toContainText('Готово — 2 тренировки в дневнике!', { timeout: 10000 });
        await page.locator('[data-act="impOpenHistory"]').click();
        await expect(page.locator('.pcard')).toHaveCount(2, { timeout: 5000 });
        const st2 = await (await request.get('/api/state')).json();
        expect(st2.workouts.length).toBe(2);
        /* свежие id не пересекаются с отменёнными (nextId монотонен) */
        const reused = (st2.workouts || []).some(function (w) { return (st.del || []).indexOf(w.id) >= 0; });
        expect(reused).toBe(false);
    });

    test('320px (§4.6): карточка «Данные», все кадры флоу и плашка — без горизонтального скролла; .unitseg 170px не ломает строку единиц', async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 680 });
        await openApp(page);
        /* Э9: плашка в пустой Истории */
        await expect(page.locator('.imp-cta')).toBeVisible({ timeout: 5000 });
        await noHScroll(page, 'плашка Э9');
        /* Э1: карточка «Данные» в Настройках */
        await page.locator('[data-act="openSettings"]').first().click();
        await expect(page.locator('.card.impdata')).toBeVisible({ timeout: 5000 });
        await noHScroll(page, 'Э1 Настройки');
        /* Э2: выбор файла — сегмент единиц: 170px зафиксированы, подпись не наезжает на сегмент */
        await page.locator('.card.impdata .arow').click();
        await expect(page.locator('[data-act="impPick"]')).toBeVisible({ timeout: 5000 });
        await noHScroll(page, 'Э2 выбор файла');
        const u = await page.evaluate(function () {
            const row = document.querySelector('.unitrow');
            const seg = row && row.querySelector('.unitseg');
            const lbl = row && row.querySelector('.ulbl');
            if (!row || !seg || !lbl) return { err: 'нет .unitrow/.unitseg/.ulbl' };
            const r = seg.getBoundingClientRect(), l = lbl.getBoundingClientRect();
            return {
                cssW: getComputedStyle(seg).width,
                segW: Math.round(r.width), overlap: l.right > r.left + 0.5,
                segIn: r.right <= document.documentElement.clientWidth + 0.5
            };
        });
        if (u.err) throw new Error(u.err);
        /* width в CSS = 170px; рендер 172px = content-box + 1px бордеры с двух сторон */
        if (u.cssW !== '170px') throw new Error('.unitseg width в CSS не 170px: ' + u.cssW);
        if (u.segW < 168 || u.segW > 176) throw new Error('.unitseg отрендерился не своей шириной: ' + u.segW);
        if (u.overlap) throw new Error('подпись «Веса в выгрузке Strong» наезжает на сегмент');
        if (!u.segIn) throw new Error('.unitseg вылезает за вьюпорт');
        /* Э4/Э5: предпросмотр с длинным «чужим» именем — раскрытие переносится, не разносит сетку */
        await pickCsv(page, 's320.csv', csv320());
        await expect(page.locator('.bignum')).toContainText('1', { timeout: 5000 });
        await page.locator('details.plain summary').click();
        await expect(page.locator('details.plain .ddlist')).toContainText('Dumbbell Incline');
        await noHScroll(page, 'Э4/Э5 предпросмотр');
        /* Э6: результат */
        await page.locator('[data-act="impConfirm"]').click();
        await expect(page.locator('.resttl')).toContainText('Готово — 1 тренировка в дневнике!', { timeout: 10000 });
        await noHScroll(page, 'Э6 результат');
        /* История с импортированной карточкой тоже живёт в 320px */
        await page.locator('[data-act="impOpenHistory"]').click();
        await expect(page.locator('.pcard').first()).toBeVisible({ timeout: 5000 });
        await noHScroll(page, 'История с импортом');
    });
});

/* ============ [FIT-S2] карта мышц тренировки (docs/spec-fit-s2-muscle-map.md) ============ */
/* сид: Подтягивания 4 подх. (m:back) + Жим штанги лёжа 2 подх. (m:chest) —
   back=4 (lvl3), chest=2/4=0.5 → lvl2, остальные группы без подсветки */
async function seedMapWorkout(request, sex, extra) {
    const day = isoDate(new Date());
    const data = {
        nextId: 2, del: [],
        profile: { sex: sex || 'м', age: 30, height: 180, weight: 90 },
        workouts: [doneWorkout(1, day, 'Подтягивания', '0', 4)]
    };
    data.workouts[0].exercises.push({ name: EX, st: day + 'T09:35:00', en: day + 'T10:00:00',
        sets: [{ w: '60', s: 2, r: '10', t: day + 'T09:40:00' }] });
    if (extra) extra(data, day);
    await request.post('/api/save', { data: { initData: '', rev: 1, data: data } });
}

test.describe('[FIT-S2] карта мышц', function () {

    test('карта рендерится на завершённой: фигуры, легенда, msum, плитки; ступени по доле подходов', async ({ page, request }) => {
        await seedMapWorkout(request, 'м');
        await openApp(page);
        await page.locator('.pcard').first().click();
        await expect(page.locator('.mapcard')).toBeVisible({ timeout: 5000 });
        /* две фигуры front/back с non-scaling-stroke зонами; подписи «Спереди»/«Сзади» */
        await expect(page.locator('#bmF svg')).toBeVisible();
        await expect(page.locator('#bmB svg')).toBeVisible();
        await expect(page.locator('.bodywrap .bname', { hasText: 'Спереди' })).toBeVisible();
        await expect(page.locator('.bodywrap .bname', { hasText: 'Сзади' })).toBeVisible();
        /* msum: 2 группы · 6 подх. (сумма вкладов групп, не число подходов тренировки) */
        await expect(page.locator('.maphead .msum')).toHaveText('2 группы · 6 подх.');
        /* легенда по убыванию подходов: Спина 4 (lvl3), Грудь 2 (lvl2) */
        const legend = page.locator('.legend .lg');
        await expect(legend).toHaveCount(2);
        await expect(legend.nth(0)).toContainText('Спина');
        await expect(legend.nth(0)).toContainText('4 подх.');
        await expect(legend.nth(1)).toContainText('Грудь');
        await expect(legend.nth(1)).toContainText('2 подх.');
        await expect(page.locator('.legend .dot.lvl3')).toHaveCount(1);
        await expect(page.locator('.legend .dot.lvl2')).toHaveCount(1);
        /* ступени на зонах: доля ≥ 2/3 → lvl3; 1/3..2/3 → lvl2; без подходов — idle-рельеф */
        await expect(page.locator('#bmF path.mz.lvl3[data-a="back"]').first()).toBeVisible();
        await expect(page.locator('#bmF path.mz.lvl2[data-a="chest"]')).toHaveCount(2); /* обе пластины груди */
        await expect(page.locator('#bmB path.mz.lvl3[data-a="back"]').first()).toBeVisible();
        const litFront = await page.locator('#bmF path.mz.lvl1, #bmF path.mz.lvl2, #bmF path.mz.lvl3').count();
        const idleFront = await page.locator('#bmF path.mz:not(.lvl1):not(.lvl2):not(.lvl3)').count();
        if (!litFront || !idleFront) throw new Error('ожидались и подсвеченные, и idle-зоны: lit=' + litFront + ' idle=' + idleFront);
        /* зоны тапабельны только у подсвеченных групп из легенды: idle-зоны без data-act */
        await expect(page.locator('#bmF path.mz[data-act="mapZone"]:not(.lvl1):not(.lvl2):not(.lvl3)')).toHaveCount(0);
        /* плитки метрик вместо пилюль */
        await expect(page.locator('.mapcard .statgrid.map3 .sg')).toHaveCount(3);
        await expect(page.locator('.statgrid.map3 .sg', { hasText: 'Продолжительность' })).toBeVisible();
        await expect(page.locator('.statgrid.map3 .sg', { hasText: 'Объём' })).toContainText('≈1200 кг');
        await expect(page.locator('.statgrid.map3 .sg', { hasText: 'Калории' })).toContainText('ккал');
    });

    test('сегмент м/ж: дефолт — пол профиля, переключение перерисовывает тела, выбор не сохраняется', async ({ page, request }) => {
        await seedMapWorkout(request, 'ж');
        await openApp(page);
        await page.locator('.pcard').first().click();
        await expect(page.locator('.mapcard')).toBeVisible({ timeout: 5000 });
        /* женское тело по умолчанию (родные наборы ассета: свой viewBox) */
        await expect(page.locator('#bmF svg')).toHaveAttribute('viewBox', /1538/);
        await expect(page.locator('.mapseg .seg-btn', { hasText: 'Женское' })).toHaveClass(/on/);
        await expect(page.locator('.mapsexnote')).toHaveText('пол профиля: ж');
        /* ручной выбор «Мужское»: тела перерисовались, уровни не изменились */
        await page.locator('.mapseg .seg-btn', { hasText: 'Мужское' }).click();
        await expect(page.locator('#bmF svg')).toHaveAttribute('viewBox', /^0 0 724 1448$/);
        await expect(page.locator('#bmB svg')).toHaveAttribute('viewBox', /^724 0 724 1448$/);
        await expect(page.locator('.mapseg .seg-btn', { hasText: 'Мужское' })).toHaveClass(/on/);
        await expect(page.locator('#bmF path.mz.lvl3[data-a="back"]').first()).toBeVisible();
        /* повторное открытие карточки — снова дефолт из профиля (ручной выбор не хранится) */
        await page.locator('.backbar [data-act="closeHistory"]').click();
        await expect(page.locator('.pcard').first()).toBeVisible({ timeout: 5000 });
        await page.locator('.pcard').first().click();
        await expect(page.locator('.mapcard')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#bmF svg')).toHaveAttribute('viewBox', /1538/);
    });

    test('тап по подсвеченной зоне — шит группы; по неактивной — ничего', async ({ page, request }) => {
        await seedMapWorkout(request, 'м');
        await openApp(page);
        await page.locator('.pcard').first().click();
        await expect(page.locator('.mapcard')).toBeVisible({ timeout: 5000 });
        /* [FIT-T1 тест-фикс iphone13] тап по трапециям «Спина» на фигуре СПЕРЕДИ (~8×7px в
           ассете) детерминированно мимо в WebKit — locator.click и force в центр bbox оба
           не попадают в тонкий путь; продукт исправен. Схема tester'а: тапаем по крупным
           зонам — грудные пластины на фронте (~22×25px) и спина на виде сзади (~16×37px) */
        /* тап по зоне «Грудь» на фигуре спереди → шит: группа, строка с подходами и тоннажем */
        await page.locator('#bmF path.mz.lvl2[data-a="chest"]').first().click();
        const modal = page.locator('.modal.open');
        await expect(modal).toBeVisible({ timeout: 5000 });
        await expect(modal.locator('.msub')).toHaveText('Задействованная группа');
        await expect(modal.locator('.mtitle')).toHaveText('Грудь · 2 подх.');
        await expect(modal.locator('.grrow')).toHaveCount(1);
        await expect(modal.locator('.grrow').first()).toContainText('Жим штанги лёжа');
        await expect(modal.locator('.grrow').first()).toContainText('2 подхода · ≈1200 кг');
        await expect(modal.locator('.grrow', { hasText: 'Подтягивания' })).toHaveCount(0);
        await modal.locator('[data-act="closeModal"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        /* повторный тап по зоне «Спина» на фигуре сзади — та же модалка без стеков */
        await page.locator('#bmB path.mz.lvl3[data-a="back"]').first().click();
        await expect(page.locator('.modal.open .mtitle')).toHaveText('Спина · 4 подх.', { timeout: 5000 });
        await expect(page.locator('.modal.open .grrow').first()).toContainText('Подтягивания');
        await expect(page.locator('.modal.open .grrow').first()).toContainText('4 подхода · без веса');
        await page.locator('.modal.open [data-act="closeModal"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        /* тап по не подсвеченной зоне — шит не открывается (§6.5). dispatchEvent вместо
           физического клика: смысл проверки — отсутствие ДЕЙСТВИЯ на уровне диспетчера
           (у idle-зоны data-act нет), физический hit-test тонких idle-путей не при чём */
        await page.locator('#bmF path.mz:not(.lvl1):not(.lvl2):not(.lvl3)').first().dispatchEvent('click');
        await expect(page.locator('.modal.open')).toHaveCount(0);
    });

    test('кардио-тренировка: силуэты без подсветки, пояснение, объём «—»', async ({ page, request }) => {
        const day = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            profile: { sex: 'м', age: 30, height: 180, weight: 90 },
            workouts: [doneWorkout(1, day, 'Беговая дорожка', '', 1)]
        } } });
        await openApp(page);
        await page.locator('.pcard').first().click();
        await expect(page.locator('.mapcard')).toBeVisible({ timeout: 5000 });
        /* каталог без m:-тегов (кардио) — норма данных: не untagged, плашки нет */
        await expect(page.locator('.mapempty', { hasText: 'Нет силовых упражнений' })).toBeVisible();
        await expect(page.locator('.legend')).toHaveCount(0);
        await expect(page.locator('.untag')).toHaveCount(0);
        await expect(page.locator('#bmF path.mz.lvl1, #bmF path.mz.lvl2, #bmF path.mz.lvl3')).toHaveCount(0);
        await expect(page.locator('.statgrid.map3 .sg', { hasText: 'Объём' })).toContainText('—');
        await expect(page.locator('.statgrid.map3 .sg', { hasText: 'Калории' })).toContainText('ккал');
    });

    test('подход с пустым s (0 подходов): группа не подсвечивается и не попадает в легенду (§6.5)', async ({ page, request }) => {
        /* [FIT-T1 ревью] у «Жима» подход-пустышка (s не заполнено, §4.3): вклад 0 —
           единственная его группа не создаёт ключ с нулём; контраст — «Тяга» 4 подх. */
        const day = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            profile: { sex: 'м', age: 30, height: 180, weight: 90 },
            workouts: [{ id: 1, date: day, started: day + 'T09:30:00', ended: day + 'T10:00:00', finished: true, title: '', nutrition: '',
                exercises: [
                    { name: EX, st: day + 'T09:31:00', en: day + 'T09:40:00', sets: [{ w: '60', s: 0, r: '10', t: day + 'T09:32:00' }] },
                    { name: 'Тяга верхнего блока', st: day + 'T09:41:00', en: day + 'T10:00:00', sets: [{ w: '55', s: 4, r: '12', t: day + 'T09:42:00' }] }
                ] }]
        } } });
        await openApp(page);
        await page.locator('.pcard').first().click();
        await expect(page.locator('.mapcard')).toBeVisible({ timeout: 5000 });
        /* легенда — только Спина 4 подх.; строк «0 подх.» нет */
        await expect(page.locator('.legend .lg')).toHaveCount(1);
        await expect(page.locator('.legend .lg', { hasText: 'Спина' })).toContainText('4 подх.');
        await expect(page.locator('.legend .lg b', { hasText: '0 подх.' })).toHaveCount(0);
        /* зона груди (группа с единственным нулевым вкладом) — без дим-подсветки */
        await expect(page.locator('#bmF path.mz.lvl1[data-a="chest"], #bmF path.mz.lvl2[data-a="chest"], #bmF path.mz.lvl3[data-a="chest"]')).toHaveCount(0);
        /* подсвечена только спина (lvl3), лишних уровней нет */
        await expect(page.locator('.legend .dot.lvl3')).toHaveCount(1);
        await expect(page.locator('#bmF path.mz.lvl3[data-a="back"]').first()).toBeVisible();
        await expect(page.locator('#bmF path.mz.lvl1, #bmF path.mz.lvl2')).toHaveCount(0);
    });

    test('[FIT-T2] «свои»: с группами подсвечиваются; без групп — плашка и редактор «Указать»', async ({ page, request }) => {
        const OWN_G = 'Тяга в своей раме';   /* с группами (m:shoulders) */
        const OWN_E = 'Жим в своей раме';    /* без групп */
        await seedMapWorkout(request, 'м', function (data, day) {
            data.customEx = [
                { n: OWN_G, tags: ['m:shoulders'] },
                { n: OWN_E, tags: [] }
            ];
            data.workouts[0].exercises.push(
                { name: OWN_G, st: day + 'T09:41:00', en: day + 'T09:50:00', sets: [{ w: '30', s: 2, r: '12', t: day + 'T09:42:00' }] },
                { name: OWN_E, st: day + 'T09:51:00', en: day + 'T10:00:00', sets: [{ w: '40', s: 1, r: '10', t: day + 'T09:52:00' }] }
            );
        });
        await openApp(page);
        await page.locator('.pcard').first().click();
        await expect(page.locator('.mapcard')).toBeVisible({ timeout: 5000 });
        /* «своё» с группами учтено: Плечи 2 подх. (lvl2: 2/4); база — Спина 4, Грудь 2 */
        await expect(page.locator('.legend .lg')).toHaveCount(3);
        await expect(page.locator('.legend .lg', { hasText: 'Плечи' })).toContainText('2 подх.');
        /* «своё» без групп — тихая плашка с кнопкой, карта считается без него */
        await expect(page.locator('.untag')).toContainText('У 1 упражнения не указаны группы');
        await page.locator('.untag button', { hasText: 'Указать' }).click();
        /* редактор групп — те же 8 чипов, что при создании; сохранение с выбором */
        const modal = page.locator('.modal.open');
        await expect(modal.locator('.mtitle')).toHaveText(OWN_E, { timeout: 5000 });
        await modal.locator('.chip', { hasText: 'Грудь' }).click();
        await expect(modal.locator('.chip', { hasText: 'Грудь' })).toHaveClass(/on/);
        await modal.locator('[data-act="customEditSave"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        /* карта пересчиталась на лету: Грудь 2+1=3 подх. (lvl3: 3/4 ≥ 2/3), плашка ушла;
           состав групп не изменился (Грудь уже была от «Жима») — изменился вклад */
        await expect(page.locator('.legend .lg', { hasText: 'Грудь' })).toContainText('3 подх.', { timeout: 5000 });
        await expect(page.locator('.legend .lg')).toHaveCount(3);
        await expect(page.locator('.untag')).toHaveCount(0);
        await expect(page.locator('#bmF path.mz.lvl3[data-a="chest"]').first()).toBeVisible();
        /* группы доехали до сервера (G.customEx[].tags) */
        const st = await (await request.get('/api/state')).json();
        const cu = (st.customEx || []).find(function (x) { return x.n === OWN_E; });
        if (!cu || JSON.stringify(cu.tags) !== JSON.stringify(['m:chest'])) {
            throw new Error('теги «своего» не сохранились: ' + JSON.stringify(cu));
        }
    });

    test('[FIT-T2] редактор групп: сохранение с пустым выбором — упражнение остаётся без групп', async ({ page, request }) => {
        const OWN_E = 'Жим в своей раме';
        await seedMapWorkout(request, 'м', function (data, day) {
            data.customEx = [{ n: OWN_E, tags: [] }];
            data.workouts[0].exercises.push(
                { name: OWN_E, st: day + 'T09:51:00', en: day + 'T10:00:00', sets: [{ w: '40', s: 1, r: '10', t: day + 'T09:52:00' }] }
            );
        });
        await openApp(page);
        await page.locator('.pcard').first().click();
        await expect(page.locator('.untag')).toContainText('У 1 упражнения не указаны группы', { timeout: 5000 });
        /* база легенды — из каталога: Спина 4 + Грудь 2 (сид); «своё» без групп не в легенде */
        await expect(page.locator('.legend .lg')).toHaveCount(2);
        await page.locator('.untag button', { hasText: 'Указать' }).click();
        await page.locator('.modal.open [data-act="customEditSave"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        /* группы не выбраны — плашка остаётся, легенда без «своего» (Спина + Грудь) */
        await expect(page.locator('.untag')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.legend .lg')).toHaveCount(2);
        await expect(page.locator('.legend .lg', { hasText: 'Спина' })).toBeVisible();
    });
});

/* ============ [FIT-T1 пост-мерж 23.11] регресс-добор цикла FIT + совместная вёрстка ============ */
test.describe('[FIT-T1 пост-мерж] регресс-добор и карта+заметка', function () {

    const NOTE_P1 = 'Тяга пошла легче: попробовать 50 кг.';
    const NOTE_P2 = 'Тяга пошла легче: попробовать 50 кг. Дописал после тренировки.';

    /* (а) мульти-теговое каталоговое упражнение: «Становая тяга» (m:back+m:legs+m:glutes) -
       полное зачисление каждой группе (§4.2): 3 легенды по 3 подх., все lvl3, шиты всех групп */
    test('становая тяга: три группы в легенде, зоны обеих фигур, шиты по 3 подх.', async ({ page, request }) => {
        const day = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            profile: { sex: 'м', age: 30, height: 180, weight: 90 },
            workouts: [{ id: 1, date: day, started: day + 'T09:30:00', ended: day + 'T10:00:00', finished: true, title: '', nutrition: '',
                exercises: [{ name: 'Становая тяга', st: day + 'T09:31:00', en: day + 'T10:00:00',
                    sets: [{ w: '100', s: 3, r: '10', t: day + 'T09:32:00' }] }] }]
        } } });
        await openApp(page);
        await page.locator('.pcard').first().click();
        await expect(page.locator('.mapcard')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.maphead .msum')).toHaveText('3 группы · 9 подх.');
        const legend = page.locator('.legend .lg');
        await expect(legend).toHaveCount(3);
        await expect(legend.nth(0)).toContainText('Ноги');
        await expect(legend.nth(1)).toContainText('Спина');
        await expect(legend.nth(2)).toContainText('Ягодицы');
        for (let i = 0; i < 3; i++) await expect(legend.nth(i)).toContainText('3 подх.');
        await expect(page.locator('.legend .dot.lvl3')).toHaveCount(3);
        await expect(page.locator('.legend .dot.lvl1, .legend .dot.lvl2')).toHaveCount(0);
        /* зоны всех трёх групп подсвечены: ноги и спина на фигуре спереди, ягодицы и ноги сзади */
        await expect(page.locator('#bmF path.mz.lvl3[data-a="legs"]').first()).toBeVisible();
        await expect(page.locator('#bmF path.mz.lvl3[data-a="back"]').first()).toBeVisible();
        await expect(page.locator('#bmB path.mz.lvl3[data-a="glutes"]').first()).toBeVisible();
        await expect(page.locator('#bmB path.mz.lvl3[data-a="legs"]').first()).toBeVisible();
        /* шит каждой группы: полное зачисление - 3 подхода и тоннаж 3000 кг (100x3x10 повторов) */
        const sheets = [
            ['#bmF path.mz.lvl3[data-a="legs"]', 'Ноги · 3 подх.'],
            ['#bmB path.mz.lvl3[data-a="glutes"]', 'Ягодицы · 3 подх.'],
            ['#bmB path.mz.lvl3[data-a="back"]', 'Спина · 3 подх.']
        ];
        for (let i = 0; i < sheets.length; i++) {
            await page.locator(sheets[i][0]).first().dispatchEvent('click');
            const modal = page.locator('.modal.open');
            await expect(modal.locator('.mtitle')).toHaveText(sheets[i][1], { timeout: 5000 });
            await expect(modal.locator('.grrow')).toHaveCount(1);
            await expect(modal.locator('.grrow').first()).toContainText('Становая тяга');
            await expect(modal.locator('.grrow').first()).toContainText('3 подхода · ≈3000 кг');
            await modal.locator('[data-act="closeModal"]').click();
            await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        }
    });

    /* (б) то же упражнение дважды в тренировке: подходы и тоннаж суммируются
       (rows по имени, §4.2): в легенде 4 подх., в шите одна строка с суммой */
    test('упражнение дважды в тренировке: сумма подходов в легенде и шите', async ({ page, request }) => {
        const day = isoDate(new Date());
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            profile: { sex: 'м', age: 30, height: 180, weight: 90 },
            workouts: [{ id: 1, date: day, started: day + 'T09:30:00', ended: day + 'T10:00:00', finished: true, title: '', nutrition: '',
                exercises: [
                    { name: EX, st: day + 'T09:31:00', en: day + 'T09:45:00', sets: [{ w: '60', s: 2, r: '10', t: day + 'T09:32:00' }] },
                    { name: EX, st: day + 'T09:46:00', en: day + 'T10:00:00', sets: [{ w: '80', s: 2, r: '10', t: day + 'T09:47:00' }] }
                ] }]
        } } });
        await openApp(page);
        await page.locator('.pcard').first().click();
        await expect(page.locator('.mapcard')).toBeVisible({ timeout: 5000 });
        /* легенда: Грудь 4 подх. (2+2), единственная группа - lvl3 */
        await expect(page.locator('.maphead .msum')).toHaveText('1 группа · 4 подх.');
        const legend = page.locator('.legend .lg');
        await expect(legend).toHaveCount(1);
        await expect(legend.nth(0)).toContainText('Грудь');
        await expect(legend.nth(0)).toContainText('4 подх.');
        await expect(page.locator('.legend .dot.lvl3')).toHaveCount(1);
        /* шит: обе записи схлопнуты в одну строку - 4 подхода, тоннаж 1200+1600=2800 кг */
        await page.locator('#bmF path.mz.lvl3[data-a="chest"]').first().dispatchEvent('click');
        const modal = page.locator('.modal.open');
        await expect(modal.locator('.mtitle')).toHaveText('Грудь · 4 подх.', { timeout: 5000 });
        await expect(modal.locator('.grrow')).toHaveCount(1);
        await expect(modal.locator('.grrow').first()).toContainText('Жим штанги лёжа');
        await expect(modal.locator('.grrow').first()).toContainText('4 подхода · ≈2800 кг');
        await modal.locator('[data-act="closeModal"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
    });

    /* совместная вёрстка (главный риск мержа): карта мышц и textarea заметки живут
       в одной завершённой карточке. Порядок блоков (карта на месте wcpill, заметка
       после «Поделиться», до details), noteFitAll при рендере, 320px/360px без
       горизонтального overflow, перерисовка фигур м/ж заметку не ломает */
    test('завершённая: карта и заметка вместе; порядок; 320/360 без overflow', async ({ page, request }) => {
        const today = isoDate(new Date());
        const note3 = 'Строка один\nСтрока два\nСтрока три';
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 2, del: [],
            profile: { sex: 'м', age: 30, height: 180, weight: 90 },
            workouts: [Object.assign(doneWorkout(1, today, EX, '120', 3), { note: note3 })]
        } } });
        await openApp(page);
        await page.locator('.pcard').first().click();
        await expect(page.locator('.mapcard')).toBeVisible({ timeout: 5000 });
        const ta = page.locator('textarea.notefield');
        await expect(ta).toBeVisible({ timeout: 5000 });
        await expect(ta).toHaveValue(note3);
        /* порядок блоков карточки: карта (на месте wcpill) - «Поделиться» - заметка - details */
        const order = await page.evaluate(function () {
            const ta = document.querySelector('textarea.notefield');
            const card = document.getElementById('w' + ta.getAttribute('data-wid'));
            const seq = Array.prototype.map.call(card.children, function (el) {
                if (el.classList.contains('mapcard')) return 'map';
                if (el.tagName === 'TEXTAREA' && el.classList.contains('notefield')) return 'note';
                if (el.tagName === 'DETAILS') return 'details';
                if (el.classList.contains('btnrow') && el.textContent.indexOf('Поделиться') >= 0) return 'share';
                return '';
            }).filter(Boolean);
            return seq.join('>');
        });
        expect(order.indexOf('map>share>note>details')).toBe(0);
        /* noteFitAll при рендере: высота по контенту (3 строки) - не схлопнута и не выше капа */
        const fit = await page.evaluate(function () {
            const ta = document.querySelector('textarea.notefield');
            const cs = getComputedStyle(ta);
            const lh = parseFloat(cs.lineHeight) || 21;
            const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
            return { h: ta.getBoundingClientRect().height, sh: ta.scrollHeight, cap: 4 * lh + pad };
        });
        expect(fit.h).toBeGreaterThanOrEqual(fit.sh - 2);
        expect(fit.h).toBeLessThanOrEqual(fit.cap + 2);
        /* 320px и 360px: блоки карты/заметки не вылезают за ширину вьюпорта */
        for (const vp of [[320, 640], [360, 740]]) {
            await page.setViewportSize({ width: vp[0], height: vp[1] });
            const m = await page.evaluate(function () {
                const vw = window.innerWidth;
                const bad = [];
                const sel = ['.mapcard', '.mapcard svg', '.legend .lg', 'textarea.notefield', '.statgrid.map3 .sg', '.btnrow .btn'];
                for (let i = 0; i < sel.length; i++) {
                    document.querySelectorAll(sel[i]).forEach(function (el) {
                        const r = el.getBoundingClientRect();
                        if (r.width > 0 && (r.right > vw + 1 || r.left < -1)) bad.push(sel[i] + ' right=' + Math.round(r.right) + '/' + vw);
                    });
                }
                return { vw: vw, sw: document.documentElement.scrollWidth, bad: bad };
            });
            expect(m.sw).toBeLessThanOrEqual(m.vw + 1);
            expect(m.bad).toEqual([]);
        }
        /* перерисовка фигур м/ж (без рендера карточки): заметка на месте */
        await page.locator('.mapseg .seg-btn', { hasText: 'Женское' }).click();
        await expect(page.locator('#bmF svg')).toHaveAttribute('viewBox', /1538/, { timeout: 5000 });
        await expect(page.locator('textarea.notefield')).toHaveValue(note3);
    });

    /* флоу-интеракция: заметка в активной -> завершение (1-А, остаёмся в карточке) ->
       в одной карточке видны и карта, и заметка; правка доезжает до сервера;
       после перезагрузки ничего не потеряно */
    test('заметка в активной -> завершить -> карта и заметка вместе; reload ничего не теряет', async ({ page, request }) => {
        await openApp(page);
        await startAndPick(page, EX);
        await page.locator('#mWeight').fill('50');
        await page.locator('#mSets').fill('3');
        await page.locator('#mReps').fill('10');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await openActiveDetail(page);
        const ta = page.locator('textarea.notefield');
        await expect(ta).toBeVisible({ timeout: 5000 });
        const noteSaved = page.waitForResponse(function (r) {
            return r.url().indexOf('/api/save') >= 0 && r.request().method() === 'POST'
                && (r.request().postData() || '').indexOf('note') >= 0;
        });
        await ta.fill(NOTE_P1);
        expect((await noteSaved).status()).toBe(200);
        /* 1-А: после завершения остаёмся в карточке - карта и заметка рядом */
        await page.locator('.backbar [data-act="finishWorkout"]').click();
        await expect(page.locator('.backbar', { hasText: 'Повторить' })).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.mapcard')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.maphead .msum')).toHaveText('1 группа · 3 подх.');
        const fin = page.locator('textarea.notefield');
        await expect(fin).toHaveValue(NOTE_P1, { timeout: 5000 });
        /* правка заметки в завершённой с картой: blur - немедленный flush до сервера */
        const editSaved = page.waitForResponse(function (r) {
            return r.url().indexOf('/api/save') >= 0 && r.request().method() === 'POST'
                && (r.request().postData() || '').indexOf('note') >= 0;
        });
        await fin.fill(NOTE_P2);
        await fin.blur();
        expect((await editSaved).status()).toBe(200);
        /* reload: и карта, и заметка на месте */
        await page.reload();
        await openApp(page);
        await page.locator('.pcard').first().click();
        await expect(page.locator('.mapcard')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('textarea.notefield')).toHaveValue(NOTE_P2, { timeout: 10000 });
        const st = await (await request.get('/api/state')).json();
        const finW = (st.workouts || []).filter(function (x) { return x.finished; })[0];
        if (!finW) throw new Error('завершённой тренировки нет на сервере');
        if (finW.note !== NOTE_P2) throw new Error('заметка потеряна: ' + JSON.stringify(finW.note));
    });
});

/* ============ [PRO-T1] Telegram Mini Apps Analytics SDK (#399) ============ */
/* Интеграция: web/vendor/tma-analytics.js (вендоренный @telegram-apps/analytics 1.6.4) +
   некоммиченный web/analytics-config.js (token/appName, в .gitignore). SDK шлёт данные
   только при параметрах запуска Telegram (tgWebAppData в hash — как при реальном открытии
   Mini App из бота); в обычном браузере init отклоняется промисом (LaunchParamsRetrieveError),
   который приложение глотает — на работу Mini App аналитика не влияет.
   Состояние интеграции — тестовый крюк __gym.tmaState(): 'off' | 'ok' | 'error'.
   Внешние хосты SDK — витрина tganalytics.xyz и антифрод-фингерпринт *.innerworks.me —
   в e2e мокается ВЕСЬ внешний трафик: тесты не ходят в интернет, счётчик ловит любой
   исходящий вызов (позитив: он есть; негатив: ноль). */
test.describe('[PRO-T1] analytics SDK', function () {

    /* конфиг аналитики как на проде: route-мок вместо некоммиченного analytics-config.js.
       '*' в конце — URL приходит с cache-busting query (?v=1, как в index.html) */
    async function mockConfig(page, token) {
        await page.route('**/analytics-config.js*', function (route) {
            return route.fulfill({
                status: 200,
                contentType: 'application/javascript; charset=utf-8',
                body: 'window.tmaAnalyticsConfig = window.tmaAnalyticsConfig || ' +
                    '{ token: ' + JSON.stringify(token) + ', appName: "gymhelper-e2e" };'
            });
        });
    }
    /* все внешние (не тестовый сервер) запросы — мок + счётчик исходящих вызовов аналитики */
    async function mockAnalyticsNet(page, counter) {
        await page.route(function (url) {
            return url.hostname !== '127.0.0.1' && url.hostname !== 'localhost';
        }, function (route) {
            counter.n++;
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
        });
    }

    test('конфиг задан: SDK инициализируется (сетевой вызов замокан) и не ломает загрузку', async ({ page }) => {
        const net = { n: 0 };
        await mockAnalyticsNet(page, net);
        await mockConfig(page, 'e2e-token');
        /* открываем как из Telegram: hash с tgWebAppData (валидность подписи SDK не проверяет) */
        await page.goto('/#tgWebAppData=user%3D%257B%2522id%2522%253A42%257D%26auth_date%3D1764000000%26hash%3Ddeadbeef');
        await expect(page.locator('#app .hero, #app .pcard').first()).toBeVisible({ timeout: 10000 });
        /* init() вызван синхронно при старте приложения */
        expect(await page.evaluate(function () { return window.__gym.tmaState(); })).toBe('ok');
        /* SDK реально вышел в сеть (витрина/антифрод) — вызовы попали в мок, не в интернет */
        await expect.poll(function () { return net.n; }, { timeout: 10000 }).toBeGreaterThan(0);
        /* приложение живо после инициализации аналитики: пикер открывается */
        await page.locator('.nav .nfab').click();
        await expect(page.locator('.modal.open')).toBeVisible({ timeout: 5000 });
    });

    test('конфига нет (404): no-op — ни одного внешнего вызова, приложение работает', async ({ page }) => {
        const net = { n: 0 };
        await mockAnalyticsNet(page, net);
        /* имитация свежего клона / прода без analytics-config.js: скрипт недоступен (404) */
        await page.route('**/analytics-config.js*', function (route) { return route.abort(); });
        await openApp(page);
        expect(await page.evaluate(function () { return window.__gym.tmaState(); })).toBe('off');
        /* окно тишины: без конфига SDK не инициализируется и не ходит в сеть */
        await page.waitForTimeout(1500);
        expect(net.n).toBe(0);
        /* приложение полностью работоспособно без аналитики */
        await page.locator('.nav .nfab').click();
        await expect(page.locator('.modal.open')).toBeVisible({ timeout: 5000 });
    });
});
