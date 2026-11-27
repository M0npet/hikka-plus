/*
 * Кнопка «UA» на великому постері сторінки тайтлу: меню «Постер» видно повністю (MK 2026-11-27 — меню мало клас big
 * і правило кнопки .big { height: 30px } сплющувало його до заголовка), вибір «Оригінал Hikka» вмикає оригінал.
 * Постер Hikka й кеш обкладинок (hp:covers) — підставлені.
 */
import { chromium, expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { SLUG, installMock } from './mock';
const EXT = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));
test('«UA» на постері тайтлу: меню з пунктами, «Оригінал Hikka» перемикає', async () => {
  const c = await chromium.launchPersistentContext('', { executablePath: process.env.HP_CHROME || undefined, channel: process.env.HP_CHROME ? undefined : 'chromium', headless: true, viewport: { width: 1400, height: 900 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  await installMock(c);
  await c.route('https://hikka.io/poster.jpg', (r) => r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="14"><rect width="10" height="14" fill="#336"/></svg>' }));
  const sw = c.serviceWorkers()[0] ?? (await c.waitForEvent('serviceworker'));
  const svg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="14"><rect width="10" height="14" fill="#a36"/></svg>');
  await sw.evaluate(({ k, svg }) => chrome.storage.local.set({ 'hp:covers': { [k]: { u: svg, b: svg, s: 'mikai', id: '1', at: Date.now(), a: 'uaposters' } } }), { k: `anime:${SLUG}`, svg });
  const page = await c.newPage();
  await page.goto(`https://hikka.io/anime/${SLUG}`);
  await page.evaluate(() => {
    const l = document.querySelector('#content-left-side')!;
    const d = document.createElement('div');
    d.innerHTML = '<div data-slot="aspect-ratio" style="position:relative;width:260px;padding-bottom:140%"><div class="@container" style="position:absolute;inset:0"><img src="https://hikka.io/poster.jpg" style="width:100%;height:100%"></div></div>';
    l.prepend(d);
  });
  const ua = page.locator('hikka-plus-cover').locator('button.ua');
  await ua.waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  await ua.click();
  await page.waitForTimeout(300);
  const items = page.locator('hikka-plus-cover').locator('.menu button');
  await expect(items).toHaveText(['Оригінал Hikka', 'Mikai (uaposters)']);
  for (const b of await items.all()) expect((await b.boundingBox())!.height).toBeGreaterThan(20);
  await page.locator('#content-left-side').screenshot({ path: '.output/e2e/ua-menu.png' });
  await items.first().click();
  await expect(page.locator('hikka-plus-cover').locator('button.ua')).toHaveClass(/off/);
  await c.close();
});
