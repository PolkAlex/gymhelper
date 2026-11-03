const { test, expect } = require('@playwright/test');
const EX = 'Жим штанги лёжа';

test.beforeEach(async function ({ request }) {
    await request.post('/api/reset');
});

test('debug: сохранение 75-175', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.hero', { timeout: 10000 });
    await page.locator('[data-act="startWorkout"]').click();
    await page.locator('.modal.open').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('.modal.open .excard', { hasText: EX }).first().click();
    await page.waitForSelector('#mWeight', { timeout: 5000 });
    await page.locator('#mWeight').fill('75-175');
    await page.locator('[data-act="setsSet"][data-a="1"]').click();
    await page.locator('[data-act="repsSet"][data-a="8"]').click();
    const st = await page.evaluate(function () {
        return {
            w: document.getElementById('mWeight').value,
            s: document.getElementById('mSets').value,
            r: document.getElementById('mReps').value
        };
    });
    console.log('BEFORE SAVE:', JSON.stringify(st));
    await page.locator('[data-act="saveEntry"]').click();
    await page.waitForTimeout(2500);
    const st2 = await page.evaluate(function () {
        return {
            modal: document.getElementById('modal').className,
            toast: (document.getElementById('toast') || {}).textContent || '',
            weight: document.getElementById('mWeight') ? document.getElementById('mWeight').value : null
        };
    });
    console.log('AFTER SAVE:', JSON.stringify(st2));
});
