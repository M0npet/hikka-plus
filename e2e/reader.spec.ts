/*
 * E2E читалки (бэклог 2g, MK 2026-11-26): манґа на підміненому hikka.io, джерело — UAManga JSON API (e2e/mock.ts, MANGA).
 * Манґа за замовчуванням — посторінково (PagedView).
 * Комп'ютер: «Читати» → оверлей, адреса #read=…, клік по правій третині — наступна сторінка, «Наступний розділ», Esc, «Продовжити».
 * Телефон (дотик): цілі ≥ 40 px, тап по центру ховає/показує панелі, тап справа і свайп — сторінки, розділ — дотиком.
 */
import { chromium, expect, test, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { MANGA, UA_SLUG, hits, installMock } from './mock';

const EXT = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));

const SIZES = [
  { name: 'комп’ютер', width: 1400, height: 900, touch: false },
  { name: 'телефон', width: 390, height: 844, touch: true },
];

for (const size of SIZES) {
  test.describe(`читалка: ${size.name}`, () => {
    test.describe.configure({ mode: 'serial' });
    let context: BrowserContext;
    let page: Page;

    test.beforeAll(async () => {
      context = await chromium.launchPersistentContext('', {
        executablePath: process.env.HP_CHROME || undefined,
        channel: process.env.HP_CHROME ? undefined : 'chromium',
        headless: true,
        viewport: { width: size.width, height: size.height },
        hasTouch: size.touch,
        isMobile: size.touch,
        args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
      });
      await installMock(context);
      if (!context.serviceWorkers().length) await context.waitForEvent('serviceworker');
      page = await context.newPage();
      await page.goto(`https://hikka.io/manga/${MANGA}`);
    });
    test.afterAll(async () => {
      await context?.close();
    });

    const reader = () => page.locator('hikka-plus-reader');
    const press = async (sel: ReturnType<Page['locator']>) => (size.touch ? sel.tap() : sel.click());
    const img = () => reader().locator('.hp-page img');
    const loaded = () => img().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0);
    /** Справжній свайп пальцем (CDP Input.dispatchTouchEvent): від x0 до x1 на висоті y. */
    const swipe = async (cdp: CDPSession, x0: number, x1: number, y: number) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
      for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / 6, y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };

    test(`${size.name}: «Читати» відкриває розділ 1`, async () => {
      const btn = page.locator('hikka-plus-read-button .hp-read');
      await expect(btn).toBeEnabled({ timeout: 20_000 });
      await expect(btn).toContainText('Розділ 1');
      // Наші блоки не розпирають сторінку ширше екрана (інакше телефон віддаляє весь hikka.io).
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
      expect(hits.get(`GET uamanga.com/api/titles/source/hikka/${MANGA}`)).toBeGreaterThan(0);
      await press(btn);
      await expect(reader()).toHaveCount(1);
      await expect(img()).toHaveAttribute('alt', 'Сторінка 1', { timeout: 15_000 });
      await expect.poll(loaded, { timeout: 10_000 }).toBe(true);
      expect(new URL(page.url()).hash).toBe('#read=uamanga%3A100');
      if (!size.touch) {
        // Права третина сторінки — наступна, ліва — попередня (схема зон «l» за замовчуванням).
        const b = (await img().boundingBox())!; // зони — по самій сторінці (clickArea «image»)
        // Середина видимої частини сторінки (сама сторінка вища за вікно).
        const y = (Math.max(b.y, 0) + Math.min(b.y + b.height, size.height)) / 2;
        await page.mouse.click(b.x + b.width * 0.85, y);
        await expect(img()).toHaveAttribute('alt', 'Сторінка 2');
        await page.mouse.click(b.x + b.width * 0.15, y);
        await expect(img()).toHaveAttribute('alt', 'Сторінка 1');
      }
    });

    if (size.touch) {
      test('телефон: цілі ≥ 40 px, тап по центру — панелі, тап справа й свайп — сторінки', async () => {
        for (const b of await reader().locator('nav.hp-bar--bottom button').all()) {
          const r = await b.boundingBox();
          if (r) expect(Math.min(r.width, r.height), (await b.getAttribute('aria-label')) ?? '').toBeGreaterThanOrEqual(39.5);
        }
        const root = reader().locator('.hp-reader');
        const box = (await reader().locator('.hp-page').boundingBox())!;
        const y = box.y + box.height / 2;
        await page.touchscreen.tap(box.x + box.width / 2, y);
        await expect(root).toHaveClass(/hp-bars-hidden/);
        await page.waitForTimeout(400);
        await page.touchscreen.tap(box.x + box.width / 2, y);
        await expect(root).not.toHaveClass(/hp-bars-hidden/);
        await page.waitForTimeout(400);
        await page.touchscreen.tap(box.x + box.width * 0.85, y);
        await expect(img()).toHaveAttribute('alt', 'Сторінка 2');
        // Свайп вліво — наступна, вправо — попередня; панелі від свайпу не ховаються.
        const cdp = await context.newCDPSession(page);
        await swipe(cdp, box.x + box.width * 0.8, box.x + box.width * 0.2, y);
        await expect(img()).toHaveAttribute('alt', 'Сторінка 3');
        await swipe(cdp, box.x + box.width * 0.2, box.x + box.width * 0.8, y);
        await expect(img()).toHaveAttribute('alt', 'Сторінка 2');
        await expect(root).not.toHaveClass(/hp-bars-hidden/);
        await page.screenshot({ path: '.output/e2e/reader-390.png' });
        // Тап одразу після свайпу Chrome віддає на зупинку інерції (без click) — як і на живому телефоні; чекаємо, як людина.
        await page.waitForTimeout(800);
      });
    }

    test(`${size.name}: «Наступний розділ» і Esc`, async () => {
      await press(reader().getByRole('button', { name: 'Наступний розділ' }));
      await expect.poll(() => new URL(page.url()).hash).toBe('#read=uamanga%3A101');
      await expect.poll(() => hits.get(`GET uamanga.com/api/titles/${UA_SLUG}/chapters/2`) ?? 0).toBeGreaterThan(0);
      await expect(img()).toHaveAttribute('src', /\/img\/2-1\.svg$/);
      await expect(img()).toHaveAttribute('alt', 'Сторінка 1');
      if (size.touch) await press(reader().getByRole('button', { name: 'Закрити' }).first());
      else await page.keyboard.press('Escape');
      await expect(reader()).toHaveCount(0);
      expect(new URL(page.url()).hash).toBe('');
      // Відкритий розділ запам'ятався — кнопка тепер «Продовжити».
      await expect(page.locator('hikka-plus-read-button .hp-read')).toContainText('Продовжити');
    });
  });
}
