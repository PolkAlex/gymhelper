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

    test('завершение тренировки: сразу список истории, дата и пилюля в превью', async ({ page }) => {
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
        /* [UX-T13] после завершения — сразу список истории, экран карточки закрыт */
        await expect(page.locator('.pcard').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.backbar')).not.toBeVisible({ timeout: 5000 });
        await expect(page.locator('.pc-date')).toContainText('.', { timeout: 5000 });
        /* тренировка реально завершена: пилюля «⚫ идёт» у превью исчезла */
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

    test('[UX-T22/T23] активная карточка: шапка 1 иконка (⏱), backbar Удалить/Завершить/Назад, плюсики и автосейв-выход', async ({ page, request }) => {
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
        /* плюсик «+ Запись» появляется в exhead вместе с упражнением; кнопки под сетами нет */
        await addBtn.click();
        await page.locator('.modal.open .secrow .chip', { hasText: 'Все' }).first().click(); /* [UX-T30] дефолт «★ Любимые» */
        await page.locator('.modal.open .excard', { hasText: EX }).first().click();
        await expect(page.locator('#mWeight')).toBeVisible({ timeout: 5000 });
        await page.locator('#mWeight').fill('100');
        await page.locator('#mSets').fill('3');
        await page.locator('#mReps').fill('8-10');
        await page.locator('[data-act="saveEntry"]').click();
        await expect(page.locator('.modal.open')).not.toBeVisible({ timeout: 5000 });
        await expect(page.locator('.expill .exhead [data-act="openEntryModal"]')).toHaveCount(1);
        await expect(page.locator('.expill .exhead [aria-label="Добавить запись"]')).toHaveCount(1);
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
        /* завершённая карточка: плюса «+ Запись» в exhead и широкой кнопки добавления нет [UX-B6] */
        await page.locator('.backbar [data-act="closeHistory"]').click();
        await expect(page.locator('.pcard').nth(1)).toBeVisible({ timeout: 5000 });
        await page.locator('.pcard').nth(1).click();
        await expect(page.locator('.wcicons').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.card [data-act="openPicker"]')).toHaveCount(0);
        await expect(page.locator('.expill .exhead [data-act="openEntryModal"]')).toHaveCount(0);
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
        await expect(page.locator('.tb-title')).toContainText('GymHelper · Техника', { timeout: 5000 });
        await expect(page.locator('.card .secrow .chip', { hasText: '★ Любимые' })).toHaveClass(/on/, { timeout: 5000 });
        await expect(page.locator('#techList .excard', { hasText: EX })).toHaveCount(1);
        await expect(page.locator('#techList .excard', { hasText: 'Подтягивания' })).toHaveCount(0);
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

    test('навигация по вкладкам, тренер и настройки', async ({ page }) => {
        await openApp(page);
        for (const label of ['Статистика', 'Техника']) {
            await page.locator('.nav button', { hasText: label }).click();
            await expect(page.locator('.tb-title')).toContainText('GymHelper · ' + label, { timeout: 5000 });
        }
        /* [UX-T27] шестерёнка открывает Настройки */
        await page.locator('[aria-label="Настройки"]').click();
        await expect(page.locator('.tb-title')).toContainText('GymHelper · Настройки', { timeout: 5000 });
        /* [UX-S4] тогл темы: ровно один role=switch «Тёмная тема» */
        await expect(page.locator('[role="switch"][aria-label="Тёмная тема"]')).toHaveCount(1);
        /* раздел «Тренер» доступен из настроек: switchTab закрывает Настройки [UX-S4 §12.9] */
        await page.locator('#app button', { hasText: 'Открыть раздел' }).click();
        await expect(page.locator('.tb-title')).toContainText('GymHelper · Тренер', { timeout: 5000 });
    });

    test('[ONB-T2] Настройки: пункт «Политика конфиденциальности», /privacy.html отдаётся со статусом 200', async ({ page }) => {
        await openApp(page);
        await page.locator('[aria-label="Настройки"]').click();
        await expect(page.locator('.tb-title')).toContainText('GymHelper · Настройки', { timeout: 5000 });
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
        await expect(page.locator('#app .hero, #app .pcard').first()).toBeVisible({ timeout: 10000 });
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

    test('статистика: карточка рекорда недели со шкалой', async ({ page, request }) => {
        /* тренировка этой недели (жим 100) и старая тренировка 3 недели назад (личный рекорд 120) */
        const now = new Date();
        const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
        const weekDay = isoDate(now);
        const oldDay = isoDate(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 21));
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 3, del: [],
            profile: { sex: 'м', age: 30, height: 180, weight: 90 },
            workouts: [doneWorkout(1, oldDay, EX, '120', 3), doneWorkout(2, weekDay, EX, '100', 3)]
        } } });
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Статистика' }).click();
        const card = page.locator('.reccard', { hasText: 'Рекорд недели · ' + EX });
        await expect(card).toHaveCount(1, { timeout: 5000 });
        await expect(card.locator('.rec-num')).toContainText('100');
        await expect(card.locator('.rec-num')).toContainText('кг');
        /* шкала = % от личного рекорда: 100 из 120 = 83% */
        await expect(card.locator('.rec-bar i')).toHaveAttribute('style', /width:\s*83%/);
        const sub = card.locator('.rec-sub');
        await expect(sub).toContainText('личный рекорд: 120 кг');
        await expect(sub).toContainText('83%');
        /* тренировки не подряд: карточка серии (даже из одного дня) не показывается */
        await expect(page.locator('.strow')).toHaveCount(0);
        /* мышечные группы этой недели: жим = грудь, 3 подхода */
        const mg = page.locator('.mg', { hasText: 'Грудь' });
        await expect(mg).toBeVisible({ timeout: 5000 });
        await expect(mg).toContainText('3 подх.');
        /* старые блоки на месте в компактном виде */
        await expect(page.locator('.statgrid')).toContainText('тренировок всего');
        await expect(page.locator('.statgrid')).toContainText('подходов всего');
        await expect(page.locator('.card', { hasText: 'Тренды' })).toBeVisible();
        await expect(page.locator('.card', { hasText: 'Упражнения' })).toBeVisible();
    });

    test('статистика: серия из двух дней подряд и группы недели', async ({ page, request }) => {
        const now = new Date();
        const today = isoDate(now);
        const yesterday = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
        const DOWS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        const dow = function (iso) { const p = iso.split('-'); return DOWS[new Date(+p[0], +p[1] - 1, +p[2]).getDay()]; };
        /* weekMuscleGroups считает только текущую неделю (Пн–Вс): в понедельник «вчера» —
           прошлая неделя, и «Подтягивания» выпадали из групп (упало 09.11.2026, пн, на всех 4
           устройствах). Фикс теста, не кода (по спеке группы — «эта неделя»): подтягивания
           сидируем всегда в текущей неделе (в Пн — сегодня), день серии добирает тренировка
           с именем вне каталога (findCatalog → null, группы не трогает). */
        const isMonday = (now.getDay() + 6) % 7 === 0;
        const pullDay = isMonday ? today : yesterday;
        const FILLER = 'Разминка и растяжка';
        await request.post('/api/save', { data: { initData: '', rev: 1, data: {
            nextId: 4, del: [],
            profile: { sex: 'м', age: 30, height: 180, weight: 90 },
            workouts: [doneWorkout(1, yesterday, FILLER, '0', 1), doneWorkout(2, pullDay, 'Подтягивания', '0', 4), doneWorkout(3, today, EX, '80', 4)]
        } } });
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Статистика' }).click();
        const st = page.locator('.strow');
        await expect(st).toBeVisible({ timeout: 5000 });
        /* серия по-прежнему из 2 дней; тренировок в ней 3 (filler + подтягивания + жим) в любой день недели */
        await expect(st.locator('b')).toContainText('Серия: 3 тренировки подряд');
        /* дни недели серии в хронологическом порядке + «самая длинная за месяц» */
        await expect(st).toContainText(dow(yesterday) + ' · ' + dow(today) + ' — самая длинная за месяц');
        /* группы: жим = грудь, подтягивания = спина (в текущей неделе), по 4 подхода */
        await expect(page.locator('.mg', { hasText: 'Грудь' })).toContainText('4 подх.', { timeout: 5000 });
        await expect(page.locator('.mg', { hasText: 'Спина' })).toContainText('4 подх.');
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
        await expect(page.locator('.tb-title')).toContainText('GymHelper · Статистика', { timeout: 5000 });
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
        await expect(page.locator('#pickerList')).toContainText('Избранных пока нет', { timeout: 5000 });
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

    test('звезда добавляет в любимые', async ({ page }) => {
        await openApp(page);
        await startWorkoutUi(page);
        await openActiveDetail(page);
        await page.locator('[data-act="openPicker"]').click();
        /* [UX-T30] дефолт — «★ Любимые» (пустые); отмечаем звезду в каталоге через «Все» */
        await page.locator('.modal.open .secrow .chip', { hasText: 'Все' }).first().click();
        const card = page.locator('#pickerList .excard', { hasText: 'Жим штанги лёжа' }).first();
        await card.locator('.star').click();
        await expect(page.locator('#pickerList .excard', { hasText: 'Жим штанги лёжа' }).locator('.star')).toHaveClass(/fav/, { timeout: 5000 });

        await page.locator('.modal.open .secrow .chip', { hasText: 'Любимые' }).click();
        await expect(page.locator('#pickerList .excard')).toHaveCount(1);
        await expect(page.locator('#pickerList .excard', { hasText: 'Жим штанги лёжа' })).toBeVisible();
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
        await page.locator('.expill .exhead [data-act="openEntryModal"]').click();
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
        await page.locator('.expill .exhead [data-act="openEntryModal"]').click();
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
        await page.locator('.expill .exhead [data-act="openEntryModal"]').first().click();
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
        await page.locator('.expill .exhead [data-act="openEntryModal"]').first().click();
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
        await page.locator('.expill .exhead [data-act="openEntryModal"]').first().click();
        const pill = page.locator('.prevpill');
        await expect(pill).toContainText('📋 План: 80 кг × 3 × 8-10 — подставить', { timeout: 5000 });
        await pill.click();
        await expect(page.locator('#mWeight')).toHaveValue('80');
        await expect(page.locator('#mSets')).toHaveValue('3');
        await expect(page.locator('#mReps')).toHaveValue('8-10');
        await page.locator('[data-act="closeModal"]').click();
        /* второе упражнение без веса: пилюля «свой вес × 4 × 8» */
        await page.locator('.expill .exhead [data-act="openEntryModal"]').nth(1).click();
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
        /* пилюля времени в карточке перерисовалась */
        await expect(page.locator('.wpill', { hasText: '07:00–08:00' })).toBeVisible({ timeout: 5000 });
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

    test('звезда в списке «Техника»: у правого края строки, тоглится, сохраняется в gymFavs и не открывает упражнение', async ({ page }) => {
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
        await expect(page.locator('.tb-title')).toContainText('GymHelper · Техника', { timeout: 5000 });
        await expect(page.locator('#techList')).toBeVisible();
        const star2 = page.locator('#techList .excard', { hasText: EX }).first().locator('.star');
        await expect(star2).toHaveClass(/fav/, { timeout: 5000 });
        await expect(star2).toHaveAttribute('aria-label', 'Из любимых');
        /* сохранено в localStorage gymFavs */
        const favs = await page.evaluate(function () { return JSON.parse(localStorage.getItem('gymFavs') || '[]'); });
        if (!favs.includes(EX)) throw new Error('gymFavs не сохранил: ' + JSON.stringify(favs));
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

/* ===== [UX-T19] чипы «Техники» с «Все», назад на вкладку-источник, профиль одним рядом ===== */
test.describe('UX-T19/T23: чипы «Техники», топбар, профиль одним рядом', function () {

    test('чипы «Техники» в порядке: ★ Любимые · Все · Вид · Блок · Мышцы · Коллекции; «Все» активен по умолчанию', async ({ page }) => {
        await openApp(page);
        await page.locator('.nav button', { hasText: 'Техника' }).click();
        await expect(page.locator('.tb-title')).toContainText('GymHelper · Техника', { timeout: 5000 });
        /* порядок чипов секций — ровно как просил владелец [UX-T24] */
        const texts = await page.locator('.card .secrow').first().locator('.chip').allTextContents();
        const expected = ['★ Любимые', 'Все', 'Вид', 'Блок', 'Мышцы', 'Коллекции'];
        if (JSON.stringify(texts) !== JSON.stringify(expected)) {
            throw new Error('порядок чипов: ' + JSON.stringify(texts) + ', ожидалось ' + JSON.stringify(expected));
        }
        /* «Все» — фильтр по умолчанию: активен, весь каталог на входе, без «Ничего не найдено» */
        await expect(page.locator('.card .secrow .chip', { hasText: 'Все' })).toHaveClass(/on/, { timeout: 5000 });
        const total = await page.locator('#techList .excard').count();
        if (total < 60) throw new Error('на входе «Техника» показывает ' + total + ' упражнений, ожидался весь каталог');
        await expect(page.locator('.empty')).toHaveCount(0);
        /* пустой favourites-набор даёт «Ничего не найдено» только внутри фильтра «★ Любимые» */
        await page.locator('.card .secrow .chip', { hasText: '★ Любимые' }).click();
        await expect(page.locator('.empty', { hasText: 'Ничего не найдено' })).toHaveCount(1, { timeout: 5000 });
        /* возврат к «Все» возвращает каталог */
        await page.locator('.card .secrow .chip', { hasText: 'Все' }).click();
        await expect(page.locator('.empty')).toHaveCount(0, { timeout: 5000 });
        await expect(page.locator('#techList .excard').first()).toBeVisible();
        /* повторный вход через навигацию снова открывает «Все» (фильтр сброшен) */
        await page.locator('.card .secrow').first().locator('.chip', { hasText: 'Блок' }).click();
        await expect(page.locator('.card .secrow').first().locator('.chip', { hasText: 'Блок' })).toHaveClass(/on/, { timeout: 5000 });
        await page.locator('.nav button', { hasText: 'История' }).click();
        await page.locator('.nav button', { hasText: 'Техника' }).click();
        await expect(page.locator('.card .secrow .chip', { hasText: 'Все' })).toHaveClass(/on/, { timeout: 5000 });
    });

    test('[UX-T23] topbar без стрелки «←» на всех вкладках: заголовок «GymHelper · <вкладка>» и шестерёнка настроек [UX-T27]', async ({ page }) => {
        await openApp(page);
        /* кнопки «Назад» (tb-back/goBack) нет ни на одной вкладке; вкладка profile снова «Профиль» */
        for (const label of ['История', 'Статистика', 'Техника', 'Профиль']) {
            await page.locator('.nav button', { hasText: label }).click();
            await expect(page.locator('.tb-title')).toContainText('GymHelper · ' + label, { timeout: 5000 });
            await expect(page.locator('.topbar [data-act="goBack"]')).toHaveCount(0);
            await expect(page.locator('.topbar .tb-back')).toHaveCount(0);
        }
        /* топбар — ровно два элемента: заголовок секции и кнопка настроек */
        const parts = await page.locator('.topbar').evaluate(function (bar) {
            return Array.prototype.slice.call(bar.children).map(function (el) {
                return (el.classList.contains('tb-title') ? 'title' : '') + (el.classList.contains('tb-user') ? 'user' : '');
            }).join(',');
        });
        if (parts !== 'title,user') throw new Error('состав topbar: ' + parts + ', ожидалось title,user');
        /* [UX-T27] кнопка шестерёнки жива: ведёт в Настройки с любой вкладки */
        await page.locator('.nav button', { hasText: 'Статистика' }).click();
        await expect(page.locator('.topbar [aria-label="Настройки"]')).toHaveCount(1);
        await page.locator('[aria-label="Настройки"]').click();
        await expect(page.locator('.tb-title')).toContainText('GymHelper · Настройки', { timeout: 5000 });
    });

    test('[UX-T23] возвраты без topbar-стрелки: «К упражнениям» в карточке техники и «⭐ Любимые» из Профиля работают', async ({ page, request }) => {
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
        /* открытое упражнение: возврат — только внутренняя «К упражнениям» (techBack не тронут) */
        await page.locator('#techList .excard', { hasText: EX }).first().click();
        await expect(page.locator('.topbar [data-act="goBack"]')).toHaveCount(0, { timeout: 5000 });
        await page.locator('[data-act="techBack"]').click();
        await expect(page.locator('#techList')).toBeVisible({ timeout: 5000 });
        /* открытая карточка тренировки: topbar без «Назад», своя навигация карточки не тронута */
        await page.locator('.nav button', { hasText: 'История' }).click();
        await page.locator('.pcard').first().click();
        await expect(page.locator('.wcicons').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.topbar [data-act="goBack"]')).toHaveCount(0);
        await page.locator('.backbar [data-act="closeHistory"]').click();
        /* «⭐ Любимые» из Профиля: переход на «Технику» с фильтром работает без lastTab-логики */
        await page.locator('.nav button', { hasText: 'Профиль' }).click();
        await page.locator('[data-act="openFavs"]').click();
        await expect(page.locator('.tb-title')).toContainText('GymHelper · Техника', { timeout: 5000 });
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
});

/* ===== [UX-T25] полноэкранный режим: тогл в Настройках [UX-T27] ===== */
test.describe('UX-T25: тогл полноэкранного режима в Настройках', function () {

    test('тогл «Полноэкранный режим»: клиент без API (мок без tg.requestFullscreen) — locked + подпись «Недоступно», тап не ставит флаг', async ({ page }) => {
        /* [UX-S4 §12.5] клиент вообще без requestFullscreen (метода нет): locked-тогл.
           Условие disabled — !(tg && tg.requestFullscreen), считается при каждом рендере */
        await page.addInitScript(function () {
            var t;
            Object.defineProperty(window, 'Telegram', {
                configurable: true,
                get: function () { return t; },
                set: function (v) {
                    t = v;
                    try {
                        Object.defineProperty(v, 'WebApp', {
                            configurable: true,
                            get: function () { return this.__wa; },
                            set: function (wa) {
                                this.__wa = wa;
                                if (wa) {
                                    try { delete wa.requestFullscreen; } catch (e) { /* noop */ }
                                }
                            }
                        });
                    } catch (e) { /* noop */ }
                }
            });
        });
        await openApp(page);
        await page.locator('[aria-label="Настройки"]').click();
        const btn = page.locator('[role="switch"][aria-label="Полноэкранный режим"]');
        await expect(btn).toBeVisible({ timeout: 5000 });
        /* locked: aria-disabled, meta-текст объясняет причину — тост и флаг не появляются */
        await expect(btn).toHaveAttribute('aria-disabled', 'true');
        await expect(page.locator('.card', { hasText: 'Полноэкранный режим' })).toContainText('Недоступно: обнови Telegram до 8.0+');
        /* pointer-events:none на locked: тап уходит в hit-test мимо кнопки — ни тоста, ни флага;
            повторный тап (двойной тап пользователя) после дедуп-окна — результат тот же */
        await btn.click({ force: true });
        await expect(page.locator('.toast.show')).toHaveCount(0);
        await page.waitForTimeout(450); /* дедуп-окно dispatchFromEl */
        await btn.click({ force: true });
        await expect(page.locator('.toast.show')).toHaveCount(0);
        const flag = await page.evaluate(function () {
            try { return localStorage.getItem('gymFullscreen'); } catch (e) { return null; }
        });
        if (flag !== null) throw new Error('gymFullscreen выставлен без поддержки API: ' + flag);
    });

    /* клиент с vendor-скриптом v6.0 (метод есть, но бросает WebAppMethodUnsupported):
       тогл активен, страховка [UX-T25] — тост «Не поддерживается этим Telegram» */
    test('тогл «Полноэкранный режим»: клиент v6.0 (метод бросает) — тап даёт тост «Не поддерживается», флаг не ставится', async ({ page }) => {
        await openApp(page);
        await page.locator('[aria-label="Настройки"]').click();
        const btn = page.locator('[role="switch"][aria-label="Полноэкранный режим"]');
        await expect(btn).toBeVisible({ timeout: 5000 });
        await btn.click();
        await expect(page.locator('.toast.show')).toHaveText('Не поддерживается этим Telegram', { timeout: 5000 });
        const flag = await page.evaluate(function () {
            try { return localStorage.getItem('gymFullscreen'); } catch (e) { return null; }
        });
        if (flag !== null) throw new Error('gymFullscreen выставлен без поддержки API: ' + flag);
    });

    test('init с сохранённым gymFullscreen=1: тихая попытка без тоста, приложение грузится', async ({ page }) => {
        /* синхронная заглушка API 8.0+: патчим WebApp в момент его присвоения (до eval app.js),
           иначе init() уже отработает с настоящим v6.0-методом */
        await page.addInitScript(function () {
            try { localStorage.setItem('gymFullscreen', '1'); } catch (e) { /* noop */ }
            var t;
            Object.defineProperty(window, 'Telegram', {
                configurable: true,
                get: function () { return t; },
                set: function (v) {
                    t = v;
                    try {
                        Object.defineProperty(v, 'WebApp', {
                            configurable: true,
                            get: function () { return this.__wa; },
                            set: function (wa) {
                                this.__wa = wa;
                                if (wa) {
                                    try { wa.requestFullscreen = function () { window.__fsCalled = (window.__fsCalled || 0) + 1; }; } catch (e) { /* noop */ }
                                }
                            }
                        });
                    } catch (e) { /* noop */ }
                }
            });
        });
        await openApp(page);
        await expect(page.locator('.tb-title')).toContainText('GymHelper', { timeout: 5000 });
        /* восстановление «тихое»: никаких тостов на старте */
        await expect(page.locator('.toast.show')).toHaveCount(0);
        const called = await page.evaluate(function () { return window.__fsCalled || 0; });
        if (called !== 1) throw new Error('init не восстановил fullscreen: вызовов requestFullscreen ' + called);
    });

    /* на реальных клиентах 8.0+ isFullscreen обновляется асинхронно (fullscreenChanged):
       успешный вызов ставит флаг сразу, без синхронной проверки isFullscreen */
    test('[UX-T25] API есть и не бросает: флаг gymFullscreen=1 и тост «включён» сразу; выключение — exitFullscreen + «Обычный режим»', async ({ page }) => {
        /* синхронная заглушка API 8.0+: requestFullscreen/exitFullscreen без ошибки (до eval app.js) */
        await page.addInitScript(function () {
            var t;
            Object.defineProperty(window, 'Telegram', {
                configurable: true,
                get: function () { return t; },
                set: function (v) {
                    t = v;
                    try {
                        Object.defineProperty(v, 'WebApp', {
                            configurable: true,
                            get: function () { return this.__wa; },
                            set: function (wa) {
                                this.__wa = wa;
                                if (wa) {
                                    try { wa.requestFullscreen = function () { window.__fsCalled = (window.__fsCalled || 0) + 1; }; } catch (e) { /* noop */ }
                                    try { wa.exitFullscreen = function () { window.__fsExited = (window.__fsExited || 0) + 1; }; } catch (e) { /* noop */ }
                                }
                            }
                        });
                    } catch (e) { /* noop */ }
                }
            });
        });
        await openApp(page);
        /* [UX-T27] тогл переехал из Профиля в Настройки */
        await page.locator('[aria-label="Настройки"]').click();
        const btn = page.locator('[role="switch"][aria-label="Полноэкранный режим"]');
        /* включение: вызов принят -> флаг '1' + тост «включён», тогл ON */
        await btn.click();
        await expect(page.locator('.toast.show')).toHaveText('Полноэкранный режим включён', { timeout: 5000 });
        await expect(btn).toHaveAttribute('aria-checked', 'true');
        const on = await page.evaluate(function () {
            return { called: window.__fsCalled || 0, flag: (function () { try { return localStorage.getItem('gymFullscreen'); } catch (e) { return null; } })() };
        });
        if (on.called !== 1) throw new Error('requestFullscreen не вызван (вызовов: ' + on.called + ')');
        if (on.flag !== '1') throw new Error('флаг gymFullscreen: ' + on.flag + ', ожидался "1"');
        /* дедап-окно dispatchFromEl 400 мс — реальный пользователь тапает повторно позже */
        await page.waitForTimeout(500);
        /* выключение: exitFullscreen + флаг '0' + тост «Обычный режим», тогл OFF */
        await page.locator('[role="switch"][aria-label="Полноэкранный режим"]').click();
        await expect(page.locator('.toast.show')).toHaveText('Обычный режим', { timeout: 5000 });
        await expect(page.locator('[role="switch"][aria-label="Полноэкранный режим"]')).toHaveAttribute('aria-checked', 'false');
        const off = await page.evaluate(function () {
            return { exited: window.__fsExited || 0, flag: (function () { try { return localStorage.getItem('gymFullscreen'); } catch (e) { return null; } })() };
        });
        if (off.exited !== 1) throw new Error('exitFullscreen не вызван');
        if (off.flag !== '0') throw new Error('флаг gymFullscreen: ' + off.flag + ', ожидался "0"');
    });
});

/* ===== [UX-B10] fullscreen safe-area: шапка не зажата статус-баром ===== */
test.describe('UX-B10: fullscreen safe-area шапки', function () {

    /* клиент 8.0+ эмулируется через НАСТОЯЩУЮ вендорскую точку входа событий
       TelegramGameProxy_receiveEvent (сестринский к UX-T25 приём: без подмены WebApp,
       сквозь реальный пайплайн fullscreen_changed/safe_area_changed -> подписка tg.onEvent) */
    test('вне fs: 10px и fs нет; вход + safe-area 44px: fs есть, паддинг 56px ([UX-B11] минимум под шапку Telegram), inset 64px побеждает; выход: fs снят', async ({ page }) => {
        await openApp(page);
        /* обычный режим: класс fs не ставится, геометрия шапки прежняя (padding 10px 12px) */
        const normal = await page.evaluate(function () {
            return {
                fs: document.body.classList.contains('fs'),
                pad: getComputedStyle(document.querySelector('.topbar')).paddingTop,
                padBottom: getComputedStyle(document.querySelector('.topbar')).paddingBottom
            };
        });
        if (normal.fs) throw new Error('класс fs на body в обычном режиме');
        if (normal.pad !== '10px') throw new Error('padding-top .topbar вне fullscreen: ' + normal.pad + ', ожидался 10px');
        if (normal.padBottom !== '10px') throw new Error('padding-bottom .topbar вне fullscreen: ' + normal.padBottom + ', ожидался 10px');
        /* клиент сообщает safe-area ещё до входа fullscreen: переменная обновляется событием safeAreaChanged */
        await page.evaluate(function () {
            window.TelegramGameProxy_receiveEvent('safe_area_changed', { top: 44, bottom: 24, left: 0, right: 0 });
        });
        const inset = await page.evaluate(function () {
            return document.documentElement.style.getPropertyValue('--fs-inset-top');
        });
        if (inset !== '44px') throw new Error('--fs-inset-top: "' + inset + '", ожидалась 44px');
        /* вход fullscreen (fullscreenChanged -> applyFsChrome): класс fs.
           [UX-B11] системная шапка Telegram («✕ Закрыть», «⌄ ⋮») висит над контентом —
           отступ минимум 56px (эмпирика, проверить на телефоне); inset 44 < 56 → 56px */
        await page.evaluate(function () {
            window.TelegramGameProxy_receiveEvent('fullscreen_changed', { is_fullscreen: true });
        });
        await expect(page.locator('body.fs .topbar')).toHaveCount(1);
        const padFs = await page.evaluate(function () {
            return getComputedStyle(document.querySelector('.topbar')).paddingTop;
        });
        if (padFs !== '56px') throw new Error('padding-top .topbar в fullscreen: ' + padFs + ', ожидался 56px ([UX-B11])');
        /* [UX-B11] компакт по вертикали: нижний паддинг в fs 6px — пилюля ниже и уже */
        const padBottomFs = await page.evaluate(function () {
            return getComputedStyle(document.querySelector('.topbar')).paddingBottom;
        });
        if (padBottomFs !== '6px') throw new Error('padding-bottom .topbar в fullscreen: ' + padBottomFs + ', ожидался 6px');
        /* safe-area больше фиксированного минимума: фактический inset побеждает (max()) */
        await page.evaluate(function () {
            window.TelegramGameProxy_receiveEvent('safe_area_changed', { top: 64, bottom: 24, left: 0, right: 0 });
        });
        const padFs64 = await page.evaluate(function () {
            return getComputedStyle(document.querySelector('.topbar')).paddingTop;
        });
        if (padFs64 !== '64px') throw new Error('padding-top .topbar в fullscreen (inset 64px): ' + padFs64 + ', ожидался 64px');
        /* выход из fullscreen тем же событием (is_fullscreen=false): класс снят, геометрия прежняя */
        await page.evaluate(function () {
            window.TelegramGameProxy_receiveEvent('fullscreen_changed', { is_fullscreen: false });
        });
        await expect(page.locator('body.fs')).toHaveCount(0);
        const padOut = await page.evaluate(function () {
            return getComputedStyle(document.querySelector('.topbar')).paddingTop;
        });
        if (padOut !== '10px') throw new Error('padding-top .topbar после выхода из fullscreen: ' + padOut + ', ожидался 10px');
        const padBottomOut = await page.evaluate(function () {
            return getComputedStyle(document.querySelector('.topbar')).paddingBottom;
        });
        if (padBottomOut !== '10px') throw new Error('padding-bottom .topbar после выхода из fullscreen: ' + padBottomOut + ', ожидался 10px');
    });

    test('старт при восстановленном из сессии fullscreen: класс fs на body сразу, без событий клиента', async ({ page }) => {
        /* вендор синхронно восстанавливает isFullscreen из sessionStorage (до eval app.js):
           applyFsChrome() на init уже ставит fs — топбар не «прыгает» после загрузки */
        await page.addInitScript(function () {
            try { window.sessionStorage.setItem('__telegram__isFullscreen', '"yes"'); } catch (e) { /* noop */ }
        });
        await openApp(page);
        await expect(page.locator('.tb-title')).toContainText('GymHelper', { timeout: 5000 });
        await expect(page.locator('body.fs .topbar')).toHaveCount(1);
    });

    /* [UX-B11] узкий экран: в fullscreen topbar не ломается на 320px —
       паддинг 56px, без горизонтального переполнения, шестерёнка кликабельна */
    test('320px: в fullscreen topbar не ломается — паддинг 56px, без переполнения, шестерёнка кликабельна', async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 640 });
        await openApp(page);
        await page.evaluate(function () {
            window.TelegramGameProxy_receiveEvent('safe_area_changed', { top: 44, bottom: 24, left: 0, right: 0 });
            window.TelegramGameProxy_receiveEvent('fullscreen_changed', { is_fullscreen: true });
        });
        await expect(page.locator('body.fs .topbar')).toHaveCount(1);
        const m = await page.evaluate(function () {
            const tb = document.querySelector('.topbar').getBoundingClientRect();
            const gear = document.querySelector('.topbar [aria-label="Настройки"]').getBoundingClientRect();
            return {
                vw: document.documentElement.clientWidth,
                overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
                pad: getComputedStyle(document.querySelector('.topbar')).paddingTop,
                tb: { left: Math.round(tb.left), right: Math.round(tb.right) },
                gear: { left: Math.round(gear.left), right: Math.round(gear.right) }
            };
        });
        if (m.pad !== '56px') throw new Error('padding-top topbar в fs на 320px: ' + m.pad + ', ожидался 56px');
        if (m.overflow) throw new Error('горизонтальное переполнение на 320px в fullscreen: ' + JSON.stringify(m));
        if (m.tb.left < 0 || m.tb.right > m.vw) throw new Error('topbar шире вьюпорта 320px в fs: ' + JSON.stringify(m.tb));
        if (m.gear.left < 0 || m.gear.right > m.vw) throw new Error('шестерёнка вылезает за 320px в fs: ' + JSON.stringify(m.gear));
        /* тап без force: Playwright проверяет hit — в fs шестерёнка реально кликабельна */
        await page.locator('.topbar [aria-label="Настройки"]').click();
        await expect(page.locator('.tb-title')).toContainText('GymHelper · Настройки', { timeout: 5000 });
        await expect(page.locator('.card', { hasText: '🎨 Оформление' })).toBeVisible({ timeout: 5000 });
        /* выход из fs тем же событием: класс снят, геометрия обычного режима (регресс 10px на 320px) */
        await page.evaluate(function () {
            window.TelegramGameProxy_receiveEvent('fullscreen_changed', { is_fullscreen: false });
        });
        await expect(page.locator('body.fs')).toHaveCount(0);
        const padOut = await page.evaluate(function () {
            return getComputedStyle(document.querySelector('.topbar')).paddingTop;
        });
        if (padOut !== '10px') throw new Error('padding-top .topbar после выхода из fs на 320px: ' + padOut + ', ожидался 10px');
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
            await expect(page.locator('.tb-title')).toContainText('GymHelper · Настройки', { timeout: 5000 });
            await expect(page.locator('.card', { hasText: '🎨 Оформление' })).toBeVisible({ timeout: 5000 });
            await expect(page.locator('.card', { hasText: '⏱ Таймер отдыха' })).toBeVisible();
            await expect(page.locator('.card', { hasText: '🧑‍🏫 Персональный тренер' })).toBeVisible();
            /* [ONB-T2] политика реализована: пункт есть в Настройках на любой вкладке */
            await expect(page.locator('#app button', { hasText: 'Политика конфиденциальности' })).toBeVisible({ timeout: 5000 });
            await page.locator('.topbar [aria-label="Назад"]').click();
            await expect(page.locator('.tb-title')).toContainText('GymHelper · ' + label, { timeout: 5000 });
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
        await expect(page.locator('.tb-title')).toContainText('GymHelper · Техника', { timeout: 5000 });
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
        await expect(page.locator('.tb-title')).toContainText('GymHelper · Настройки', { timeout: 5000 });
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
        await expect(page.locator('.tb-title')).toContainText('GymHelper · Настройки', { timeout: 5000 });
        await expect(page.locator('.backbar')).toHaveCount(0);
        /* сеть восстановилась: тап по табу нижней навигации закрывает Настройки
           и запускает dirty-автосейв карточки [UX-S4 §8.4] */
        failSave = false;
        await page.locator('.nav button', { hasText: 'Статистика' }).click();
        await expect(page.locator('.tb-title')).toContainText('GymHelper · Статистика', { timeout: 5000 });
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

/* ============ [UX-S6] календарь тренировок (18 кейсов §14 спеки) ============ */
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

    test('§14.1 точка входа: кнопка на Истории перед шестерёнкой, тап открывает, Назад возвращает, на других вкладках нет', async ({ page }) => {
        await openApp(page);
        const calBtn = page.locator('.topbar [data-act="openCal"]');
        await expect(calBtn).toHaveCount(1);
        /* порядок: календарь СЛЕВА, шестерёнка справа [§3.2] */
        const btns = page.locator('.topbar .tb-user');
        await expect(btns.nth(0)).toHaveAttribute('aria-label', 'Календарь');
        await expect(btns.nth(1)).toHaveAttribute('aria-label', 'Настройки');
        await calBtn.click();
        await expect(page.locator('.tb-title')).toHaveText('GymHelper · Календарь');
        await expect(page.locator('.topbar [data-act="closeCal"]')).toHaveCount(1);
        await expect(page.locator('.cal-grid')).toBeVisible();
        await page.locator('.topbar [data-act="closeCal"]').click();
        await expect(page.locator('.topbar [data-act="openCal"]')).toHaveCount(1);
        /* на остальных вкладках кнопки календаря нет */
        for (const t of ['Статистика', 'Техника', 'Профиль']) {
            await page.locator('.nav button', { hasText: t }).click();
            await expect(page.locator('.topbar [data-act="openCal"]')).toHaveCount(0);
            await expect(page.locator('.topbar [data-act="closeCal"]')).toHaveCount(0);
        }
    });

    test('§14.2 кнопка скрыта: при открытой карточке тренировки и на экране Настроек', async ({ page, request }) => {
        const today = isoDate(new Date());
        await seedWorkouts(request, [workoutAt(1, today, '09:30:00', '10:30:00', EX)]);
        await openApp(page);
        await page.locator('.pcard').first().click();
        await expect(page.locator('.wcicons').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.topbar [data-act="openCal"]')).toHaveCount(0);
        await page.locator('.bb-back').click();
        await page.locator('.topbar [data-act="openSettings"]').click();
        await expect(page.locator('.tb-title')).toHaveText('GymHelper · Настройки');
        await expect(page.locator('.topbar [data-act="openCal"]')).toHaveCount(0);
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

    test('§14.4 тап дня с 1 тренировкой → карточка; «Назад» → календарь с тем же месяцем', async ({ page, request }) => {
        const ym = monthShift(-1), now = new Date();
        const dayPrev = isoOf(ym, 5), today = isoDate(now);
        await seedWorkouts(request, [
            workoutAt(1, dayPrev, '09:30:00', '10:30:00', EX),
            workoutAt(2, today, '09:30:00', '10:30:00', EX)
        ]);
        await openApp(page);
        await openCalendar(page);
        await expect(page.locator('.cal-title')).toHaveText(CAL_MONTHS[now.getMonth()] + ' ' + now.getFullYear());
        await page.locator('[data-act="calPrev"]').click();
        await expect(page.locator('.cal-title')).toHaveText(CAL_MONTHS[ym.m] + ' ' + ym.y);
        await page.locator('.cal-d[data-a="' + dayPrev + '"]').click();
        await expect(page.locator('.backbar')).toBeVisible({ timeout: 5000 });
        /* calOpen сохранён: «Назад» backbar'а возвращает в КАЛЕНДАРЬ [§6] */
        await page.locator('.bb-back').click();
        await expect(page.locator('.cal-grid')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.cal-title')).toHaveText(CAL_MONTHS[ym.m] + ' ' + ym.y);
        await expect(page.locator('.tb-title')).toHaveText('GymHelper · Календарь');
    });

    test('§14.5 тап дня с 2 тренировками → панель дня, тап строки → карточка по id', async ({ page, request }) => {
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
        await expect(panel.locator('.dph .cnt')).toHaveText('2 тренировки');
        await expect(panel.locator('.drow')).toHaveCount(2);
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

    test('§14.6 навигация: ‹/› работают, «Сегодня» только на не-текущем месяце', async ({ page, request }) => {
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

    test('§14.7 предел назад = январь 2020: ‹ disabled', async ({ page, request }) => {
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

    test('§14.8 память месяца: закрыл/открыл — месяц тот же (gymCalMonth)', async ({ page, request }) => {
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

    test('§14.9 битый gymCalMonth: без ошибки, дефолтный месяц (месяц последней тренировки)', async ({ page, request }) => {
        const now = new Date();
        const today = isoDate(now);
        await seedWorkouts(request, [workoutAt(1, today, '09:30:00', '10:30:00', EX)]);
        await openApp(page);
        await page.evaluate(function () { localStorage.setItem('gymCalMonth', '99x'); });
        await openCalendar(page);
        await expect(page.locator('.cal-title')).toHaveText(CAL_MONTHS[now.getMonth()] + ' ' + now.getFullYear());
        /* ключ перезаписан валидным значением [§7.3] */
        const saved = await page.evaluate(function () { return localStorage.getItem('gymCalMonth'); });
        expect(saved).toBe(now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0'));
    });

    test('§14.10 «сегодня»: рамка+фон; с активной — полая точка', async ({ page, request }) => {
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

    test('§14.11 пустой месяц (есть ранние): честный текст, БЕЗ подсказок (заготовка выключена), «Сегодня» видна', async ({ page, request }) => {
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

    test('§14.12 пустой месяц (ранних нет): текст без подсказок, «Сегодня» возвращает к точке', async ({ page, request }) => {
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

    test('§14.13 ноль тренировок: «Пока нет тренировок», пилюли нет, hero Истории не изменился', async ({ page }) => {
        await openApp(page);
        await expect(page.locator('#app .hero', { hasText: 'Пока пусто' })).toBeVisible();
        await openCalendar(page);
        await expect(page.locator('.calempty')).toHaveText('Пока нет тренировок');
        /* месяц дефолтный = текущий → «Сегодня» нет [S6-update2] */
        await expect(page.locator('.cal-today')).toHaveCount(0);
        await page.locator('.topbar [data-act="closeCal"]').click();
        await expect(page.locator('#app .hero', { hasText: 'Пока пусто' })).toBeVisible();
    });

    test('§14.14 битая дата: в списке есть, в календаре точки нет, ошибок в консоли нет', async ({ page, request }) => {
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

    test('§14.15 320px: сетка без горизонтального скролла, 7 колонок, topbar в одну строку', async ({ page }) => {
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

    test('§14.16 предел вперёд = декабрь 2030: › disabled, ‹ активна', async ({ page, request }) => {
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

    test('§14.17 будущий месяц пуст: честный текст + «Сегодня», возврат к точке тренировки', async ({ page, request }) => {
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

    test('§14.18 заготовка подсказки: SHOW_MONTH_HINTS=false — .calhint нет; ветка рендера в коде есть', async ({ page, request }) => {
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

    /* ниже — усиление тестировщика сверх 18 кейсов спецификации [§14]: переход через
       границу годов стрелкой и полая точка активной тренировки ВНЕ сегодняшней клетки */
    test('§14.19 граница годов: декабрь 2020 → январь 2021 стрелкой и назад, сетка Пн-старт не ломается', async ({ page, request }) => {
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
        /* gymCalMonth пережил переход года [§7.3] */
        const saved = await page.evaluate(function () { return localStorage.getItem('gymCalMonth'); });
        expect(saved).toBe('2021-01');
        /* ‹ назад через границу → декабрь 2020, точка на месте */
        await page.locator('[data-act="calPrev"]').click();
        await expect(page.locator('.cal-title')).toHaveText('Декабрь 2020');
        await expect(page.locator('.cal-d[data-a="2020-12-31"] .dot')).toHaveCount(1);
    });

    test('§14.20 полая точка активной тренировки вне сегодняшней клетки: hollow, «идёт тренировка»', async ({ page, request }) => {
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
