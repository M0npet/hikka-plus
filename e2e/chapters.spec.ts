/*
 * E2E «Нові розділи» (бэклог h, MK 2026-11-26): тайтл, який читали в нашій читалці, потрапляє в список; фон перевіряє
 * джерело напряму (UAManga JSON API з e2e/mock.ts, net.ts setDirectFetch) → число на іконці; відкрили тайтл — побачено.
 */
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { MANGA, MANGA_CHAPTERS, UA_SLUG, hits, installMock, mockState } from './mock';

const EXT = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));
const KEY = `manga:${MANGA}`;

test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let sw: Worker;
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
  sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
});

test.afterAll(async () => {
  mockState.mangaChapters = MANGA_CHAPTERS;
  await context?.close();
});

type Track = { n: number; seen: number; s: string; sn: string; id: string; name: string };
const track = () => sw.evaluate(async (k) => ((await chrome.storage.local.get('hp:chaps'))['hp:chaps'] as Record<string, Track> | undefined)?.[k] ?? null, KEY);
const badge = () => sw.evaluate(() => chrome.action.getBadgeText({}));

test('без читання — не стежимо; прочитали розділ — тайтл у списку', async () => {
  page = await context.newPage();
  await page.goto(`https://hikka.io/manga/${MANGA}`);
  const btn = page.locator('hikka-plus-read-button .hp-read');
  await expect(btn).toBeEnabled({ timeout: 20_000 });
  await page.waitForTimeout(500);
  expect(await track()).toBeNull();

  await btn.click();
  await expect(page.locator('hikka-plus-reader .hp-page img')).toHaveAttribute('alt', 'Сторінка 1', { timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect.poll(track, { timeout: 10_000 }).toMatchObject({ n: MANGA_CHAPTERS, seen: MANGA_CHAPTERS, s: 'uamanga', sn: 'UAManga', id: UA_SLUG, name: 'Тестова манґа' });
  expect(await badge()).toBe('');
});

test('фон: новий розділ → число на іконці й рядок у вікні по іконці', async () => {
  mockState.mangaChapters = MANGA_CHAPTERS + 1;
  const before = hits.get(`GET uamanga.com/api/titles/${UA_SLUG}/chapters`) ?? 0;
  const id = new URL(sw.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  // «Перевірити зараз» приймається лише зі сторінок розширення.
  const r = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'hp-chaps', op: 'check' }));
  expect(r).toMatchObject({ ok: true, found: 1 });
  expect(hits.get(`GET uamanga.com/api/titles/${UA_SLUG}/chapters`)).toBe(before + 1); // один запит (getLatest)
  expect(await track()).toMatchObject({ n: MANGA_CHAPTERS + 1, seen: MANGA_CHAPTERS });
  await expect.poll(badge).toBe('1');
  await popup.reload();
  const news = popup.locator('.hp-dub-news', { hasText: 'Нові розділи' });
  await expect(news).toContainText('Тестова манґа');
  await expect(news).toContainText('+1');
  await popup.close();
});

test('відкрили тайтл — нове побачено, число зникає', async () => {
  await page.reload();
  await expect(page.locator('hikka-plus-read-button .hp-read')).toBeEnabled({ timeout: 20_000 });
  await expect.poll(track, { timeout: 10_000 }).toMatchObject({ n: MANGA_CHAPTERS + 1, seen: MANGA_CHAPTERS + 1 });
  await expect.poll(badge).toBe('');
});
