/*
 * E2E довгого тайтлу (бэклог 2a, MK 2026-11-26): типи серій з AnimeFillerList (суворий пошук шоу, кольорові риски
 * в сітці + легенда) і «Далі з «Дивлюсь»» на останній серії тайтлу без франшизи (POST /watch/{user}/list).
 * Мережа — e2e/mock.ts (тайтл LONG).
 */
import { chromium, expect, test, type BrowserContext, type Frame, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { LONG, LONG_EPS, UP_NEXT, USER, hits, installMock } from './mock';

const EXT = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));

test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext('', {
    executablePath: process.env.HP_CHROME || undefined,
    channel: process.env.HP_CHROME ? undefined : 'chromium',
    headless: true,
    viewport: { width: 1400, height: 900 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  await installMock(context);
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  // Ім'я того, хто зайшов на Hikka: на справжньому сайті його кладе міст (кеш `profile` → ME_EVENT).
  await sw.evaluate((u) => chrome.storage.local.set({ 'hp:me': u }), USER);
});

test.afterAll(async () => {
  await context?.close();
});

const watch = () => page.locator('hikka-plus-watch');

async function fenixFrame(n: number): Promise<Frame> {
  const url = `https://fenixplay.xyz/vod/op-${n}`;
  await expect.poll(() => page.frames().some((f) => f.url().startsWith(url)), { timeout: 15_000 }).toBe(true);
  return page.frames().find((f) => f.url().startsWith(url))!;
}

const kindOf = (n: number) =>
  watch()
    .locator('.hp-watch__grid .hp-watch__ep')
    .nth(n - 1)
    .evaluate((b) => /hp-watch__eptype--(\w)/.exec(b.querySelector('.hp-watch__eptype')?.className ?? '')?.[1] ?? '');

test('типи серій з AnimeFillerList: риски в сітці й легенда', async () => {
  page = await context.newPage();
  await page.goto(`https://hikka.io/anime/${LONG}`);
  await expect(watch().locator('.hp-watch__grid .hp-watch__ep')).toHaveCount(LONG_EPS, { timeout: 20_000 });
  await fenixFrame(1);

  // Шоу знайдено точно: «One Piece», а не «One Pace (One Piece)» і не фільми.
  await expect(watch().locator('.hp-watch__eplegend > span')).toHaveCount(3, { timeout: 15_000 });
  expect(hits.get('GET www.animefillerlist.com/shows/one-piece')).toBe(1);
  expect(hits.get('GET www.animefillerlist.com/shows/one-pace')).toBeUndefined();
  await expect(watch().locator('.hp-watch__eplegend')).toContainText('Канон (аніме)');
  await expect(watch().locator('.hp-watch__eplegend')).toContainText('Змішаний');
  await expect(watch().locator('.hp-watch__eplegend')).toContainText('Філер');

  // Канон манґи — без позначки; 4–5 канон аніме, 6 змішаний, 7–8 філер.
  expect(await Promise.all([1, 4, 5, 6, 7, 8, 9].map(kindOf))).toEqual(['', 'a', 'a', 'x', 'f', 'f', '']);
  // Mikai як запасне джерело не питали — AFL відповів.
  expect(hits.get(`GET api.mikai.me/public/v1/anime/hikka:${LONG}`)).toBeUndefined();
});

test('«Далі з «Дивлюсь»» на останній серії без наступного сезону', async () => {
  // До останньої серії список «Дивлюсь» не питаємо.
  expect(hits.get(`POST api.hikka.io/watch/${USER}/list`)).toBeUndefined();
  await watch().locator('.hp-watch__grid .hp-watch__ep').nth(LONG_EPS - 1).click();
  const f = await fenixFrame(LONG_EPS);
  // 1440 с без міток → поріг 1296 с.
  await f.evaluate(() => (window as unknown as { __tick: (t: number) => void }).__tick(1300));
  const btn = watch().locator('.hp-ob--primary');
  await expect(btn).toContainText('Далі з «Дивлюсь»', { timeout: 10_000 });
  expect(hits.get(`GET api.hikka.io/related/anime/${LONG}/franchise`)).toBeGreaterThan(0);
  expect(hits.get(`POST api.hikka.io/watch/${USER}/list`)).toBe(1);
  // Поточний тайтл і повністю переглянутий пропущено.
  await expect(btn.locator('.hp-ob__sub')).toHaveText(`${UP_NEXT.title} · Серія ${UP_NEXT.ep}`);
  await btn.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __nav: string[] }).__nav)).toEqual([`/anime/${UP_NEXT.slug}`]);
});
