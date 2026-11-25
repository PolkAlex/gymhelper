// Рендер карусели: HTML → PNG 1080×1350 (Playwright headless).
// Использование: node render-carousel.js <путь-к-carousel.html> <папка-вывода>
// Зависимость: playwright уже в node_modules репо (dev-зависимость e2e).
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const htmlPath = path.resolve(process.argv[2] || path.join(__dirname, 'carousel.html'));
  const outDir = process.argv[3] || __dirname;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
  await page.goto('file:///' + htmlPath.replace(/\\/g, '/'));
  await page.waitForTimeout(400); // дождаться шрифтов

  const slides = await page.$$('.slide');
  console.log('slides found:', slides.length);
  for (let i = 0; i < slides.length; i++) {
    const box = await slides[i].boundingBox();
    const overflow = await slides[i].evaluate((el) => el.scrollHeight > el.clientHeight + 2);
    if (overflow) console.log(`WARNING: slide ${i + 1} content overflows (scrollHeight > clientHeight)`);
    const name = `slide-${String(i + 1).padStart(2, '0')}.png`;
    await slides[i].screenshot({ path: path.join(outDir, name) });
    console.log('saved', name, `(${Math.round(box.width)}x${Math.round(box.height)})`);
  }
  await browser.close();
})();
