/*
 * E2E плеєра на підміненому hikka.io (MK 2026-11-26): збірка chrome-mv3, мережа — e2e/mock.ts.
 * Перевіряє: блок «Перегляд» після опису, команду й iframe з публічного API Mikai, назви серій (Hikka /episodes),
 * «Наступна серія» з назвою на порозі зарахування, «Наступний сезон» на останній серії (Hikka franchise) і SPA-перехід.
 */
import { chromium, expect, test, type BrowserContext, type Frame, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { EP_TITLES, SEQUEL, SLUG, TEAM, hits, installMock } from './mock';

const EXT = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));

test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext('', {
    // Chrome for Testing / Chromium: розпаковане розширення через --load-extension (у брендованому Chrome вимкнено).
    executablePath: process.env.HP_CHROME || undefined,
    // Без HP_CHROME — повний Chromium Playwright (у chrome-headless-shell розширень немає).
    channel: process.env.HP_CHROME ? undefined : 'chromium',
    headless: true,
    viewport: { width: 1400, height: 900 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  await installMock(context);
  // Фон розширення піднявся — інакше запити content script нікуди не підуть.
  if (!context.serviceWorkers().length) await context.waitForEvent('serviceworker');
});

test.afterAll(async () => {
  await context?.close();
});

const watch = () => page.locator('hikka-plus-watch');

async function fenixFrame(n: number): Promise<Frame> {
  await expect.poll(() => page.frames().some((f) => f.url().startsWith(`https://fenixplay.xyz/vod/test-${n}`)), { timeout: 15_000 }).toBe(true);
  return page.frames().find((f) => f.url().startsWith(`https://fenixplay.xyz/vod/test-${n}`))!;
}

test('блок «Перегляд»: Mikai public API + назви серій', async () => {
  page = await context.newPage();
  await page.goto(`https://hikka.io/anime/${SLUG}`);

  // Блок між «Опис» і «Головні персонажі».
  await expect(watch()).toHaveCount(1, { timeout: 20_000 });
  const order = await page.evaluate(() => {
    const host = document.querySelector('hikka-plus-watch')!;
    const top = (el: Element) => (el.closest('#content-center > *') ?? el) as Element;
    return top(host).previousElementSibling?.id;
  });
  expect(order).toBe('content-description');

  await expect(watch().getByText(TEAM).first()).toBeVisible({ timeout: 20_000 });
  await fenixFrame(1);
  expect(hits.get(`GET api.mikai.me/public/v1/anime/hikka:${SLUG}/player`)).toBeGreaterThan(0);

  // Назва поточної серії під «Серія 1 з 2».
  await expect(watch().locator('.hp-watch__eptitle')).toHaveText(EP_TITLES[1], { timeout: 15_000 });
});

test('«Наступна серія» з назвою на порозі зарахування', async () => {
  const f = await fenixFrame(1);
  // 1440 с, міток немає → поріг 10 % (≤ 2:30) = 1296 с.
  await f.evaluate(() => (window as unknown as { __tick: (t: number) => void }).__tick(1300));
  const next = watch().locator('.hp-ob--primary');
  await expect(next).toContainText('Наступна серія', { timeout: 10_000 });
  await expect(next.locator('.hp-ob__sub')).toHaveText(EP_TITLES[2]);
  await next.click();
  await fenixFrame(2);
  await expect(watch().locator('.hp-watch__eptitle')).toHaveText(EP_TITLES[2], { timeout: 10_000 });
});

test('«Наступний сезон» на останній серії → SPA-перехід', async () => {
  const f = await fenixFrame(2);
  await f.evaluate(() => (window as unknown as { __tick: (t: number) => void }).__tick(1300));
  const season = watch().locator('.hp-ob--primary');
  await expect(season).toContainText('Наступний сезон', { timeout: 10_000 });
  await expect(season.locator('.hp-ob__sub')).toHaveText('Фрірен 2');
  expect(hits.get(`GET api.hikka.io/related/anime/${SLUG}/franchise`)).toBeGreaterThan(0);
  await season.click();
  // Міст (hikka-bridge) переходить роутером Hikka — у моку він записує шлях у window.__nav, сторінка не перезавантажується.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __nav: string[] }).__nav)).toEqual([`/anime/${SEQUEL}`]);
  expect(new URL(page.url()).pathname).toBe(`/anime/${SEQUEL}`);
});
