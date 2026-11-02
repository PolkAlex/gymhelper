const { test, expect } = require('@playwright/test');

const EX = 'Жим штанги лёжа';

test.beforeEach(async function ({ request }) {
    await request.post('/api/reset');
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
    await page.locator('.wrow').first().click();
    await expect(page.locator('.wcicons').first()).toBeVisible({ timeout: 5000 });
}

test.describe('GymHelper e2e', function () {

    test('старт: пикер открывается сразу после начала тренировки', async ({ page }) => {
        await openApp(page);
        await startAndPick(page, EX);
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
        await page.locator('.expill .entry .recbtn').first().click();
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
        await page.locator('.expill .entry .recbtn').nth(1).click();
        await page.locator('.modal.open [data-act="confirmYes"]').click();
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
        await page.locator('.expill .exhead [data-act="renameExercise"]').click();
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
        await expect(page.locator('.wcrange', { hasText: '09:30' })).toBeVisible({ timeout: 5000 });
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
        await expect(page.locator('.wcrange', { hasText: '10:00–11:30' })).toBeVisible({ timeout: 5000 });
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
        await page.locator('.wcicons [data-act="titleModal"]').click();
        await page.locator('#mTitle').fill('Спина и грудь');
        await page.locator('[data-act="saveTitle"]').click();
        await expect(page.locator('.t1', { hasText: 'Спина и грудь' })).toBeVisible({ timeout: 5000 });
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

    test('выбранная тема сохраняется после перезагрузки', async ({ page }) => {
        await openApp(page);
        await page.locator('.topbar .tb-user').click();
        await page.locator('.themecard', { hasText: 'Stockline' }).click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'stockline', { timeout: 5000 });
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'stockline', { timeout: 5000 });
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
});
