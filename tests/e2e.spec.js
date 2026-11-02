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
        await expect(page.locator('.expill .entry').first()).toContainText('100 кг, 3 по 8-10', { timeout: 5000 });
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
        await expect(page.locator('.expill .entry').first()).toContainText('80 кг, 4 по 10', { timeout: 10000 });
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
        await expect(page.locator('.expill .entry').first()).toContainText('110 кг, 5 по 8-10', { timeout: 5000 });
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

    test('питание и название тренировки', async ({ page }) => {
        await openApp(page);
        await startWorkoutUi(page);
        await openActiveDetail(page);
        await page.locator('.iconrow [data-act="nutrModal"]').click();
        await page.locator('#mNutr').fill('Вода, BCAA');
        await page.locator('[data-act="saveNutr"]').click();
        await expect(page.locator('.meta', { hasText: '🥤 Вода, BCAA' })).toBeVisible({ timeout: 5000 });

        await page.locator('.wcicons [data-act="titleModal"]').click();
        await page.locator('#mTitle').fill('Спина и грудь');
        await page.locator('[data-act="saveTitle"]').click();
        await expect(page.locator('.t1', { hasText: 'Спина и грудь' })).toBeVisible({ timeout: 5000 });
    });
});
