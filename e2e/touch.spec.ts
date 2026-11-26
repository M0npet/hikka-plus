/*
 * Телефон і планшет (MK 2026-11-26 17:39: «на сенсорных экранах, планшетах и т.д. должно отлично работать»):
 * той самий підмінений hikka.io (e2e/mock.ts), вікно телефону з дотиком. Перевіряє, що панелі поверх плеєра не налазять
 * одна на одну (телефон — вузький плеєр, @container hp-view), «N / M» не обрізано, цілі дотику не дрібніші за 40 px,
 * а меню серій відкривається дотиком.
 */
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { SLUG, installMock } from './mock';

const EXT = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));
const SIZES = [
  { name: 'телефон', width: 390, height: 844 },
  { name: 'планшет', width: 820, height: 1180 },
];

for (const size of SIZES) {
  test.describe(size.name, () => {
    let context: BrowserContext;
    let page: Page;
    test.beforeAll(async () => {
      context = await chromium.launchPersistentContext('', {
        executablePath: process.env.HP_CHROME || undefined,
        channel: process.env.HP_CHROME ? undefined : 'chromium',
        headless: true,
        viewport: { width: size.width, height: size.height },
        hasTouch: true,
        isMobile: true,
        args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
      });
      await installMock(context);
      if (!context.serviceWorkers().length) await context.waitForEvent('serviceworker');
      page = await context.newPage();
      await page.goto(`https://hikka.io/anime/${SLUG}`);
    });
    test.afterAll(async () => {
      await context?.close();
    });

    test(`${size.name}: панелі поверх плеєра`, async () => {
      const watch = page.locator('hikka-plus-watch');
      const left = watch.locator('.hp-watch__tools--left');
      const right = watch.locator('.hp-watch__tools:not(.hp-watch__tools--left)');
      await expect(left).toHaveClass(/hp-watch__tools--on/, { timeout: 20_000 });
      // Панелі з'являються з анімацією (масштаб вмісту) — міряємо після неї.
      await expect(right).toHaveClass(/hp-watch__tools--on/);
      await expect
        .poll(() => watch.locator('.hp-watch__tools > *').evaluateAll((els) => els.every((e) => getComputedStyle(e).transform === 'none')))
        .toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
      await left.scrollIntoViewIfNeeded();
      const view = (await watch.locator('.hp-watch__view').boundingBox())!;
      const a = (await left.boundingBox())!;
      const b = (await right.boundingBox())!;
      await page.screenshot({ path: `.output/e2e/touch-${size.width}.png` });
      // Не налазять одна на одну й не виходять за кадр.
      const overlap = a.x + a.width > b.x && b.x + b.width > a.x && a.y + a.height > b.y && b.y + b.height > a.y;
      expect(overlap, `ліва ${JSON.stringify(a)} / права ${JSON.stringify(b)}`).toBe(false);
      for (const r of [a, b]) {
        expect(r.x).toBeGreaterThanOrEqual(view.x - 1);
        expect(r.x + r.width).toBeLessThanOrEqual(view.x + view.width + 1);
      }
      // Цілі дотику ≥ 40 px.
      for (const btn of await watch.locator('.hp-watch__tools .hp-watch__tool').all()) {
        const r = await btn.boundingBox();
        if (r) expect(Math.min(r.width, r.height), await btn.getAttribute('aria-label') ?? '').toBeGreaterThanOrEqual(39.5);
      }
      // «N / M» не обрізано (3302d14 стискав його до 40 px на дотику).
      const ep = watch.locator('.hp-watch__tools--left .hp-watch__tool--ep');
      expect(await ep.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      // Меню серій — дотиком.
      await watch.locator('.hp-watch__tools--left .hp-watch__epbtn, .hp-watch__tools--left [aria-haspopup]').first().tap();
      await expect(watch.locator('.hp-watch__eppop')).toBeVisible();
      await page.screenshot({ path: `.output/e2e/touch-${size.width}-menu.png` });
    });
  });
}
