/*
 * E2E: неактивне джерело — лише найновіші розділи (MK 2026-11-27: «тільки активне + рахунок дешево»).
 * Тайтл прив'язаний до Zenko (пріоритетніше, стає активним) і UAManga. UAManga при відкритті тайтлу — один запит
 * (getLatest, перша сторінка), на плашці «~N»; клік по плашці — повний список (запит списку розділів ще раз).
 */
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { MANGA, MANGA_CHAPTERS, UA_SLUG, hits, installMock } from './mock';

const EXT = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));
const ZENKO_ID = '777';
const SEP = '@#%&;№%#&**#!@';
const ZENKO_CHAPTERS = 2;

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
  // Zenko: лише список розділів (getChapters — один JSON).
  await context.route(/api\.zenko\.online\//, (route) => {
    const u = new URL(route.request().url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (u.pathname === `/titles/${ZENKO_ID}/chapters`)
      return json(Array.from({ length: ZENKO_CHAPTERS }, (_, i) => ({ id: 500 + i, name: `1${SEP}${i + 1}${SEP}`, titleId: Number(ZENKO_ID), isPublished: true })));
    return json({ error: 'not found' }, 404);
  });
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await sw.evaluate(
    ([slug, zid, uid]) =>
      chrome.storage.local.set({
        [`hp:bind2:manga:${slug}`]: {
          active: null,
          links: {
            zenko: { remoteId: zid, title: 'Тестова манґа', url: `https://zenko.online/titles/${zid}`, manual: true },
            uamanga: { remoteId: uid, title: 'Тестова манґа', url: `https://uamanga.com/title/${uid}`, manual: true },
          },
          teams: {},
          misses: {},
        },
      }),
    [MANGA, ZENKO_ID, UA_SLUG],
  );
});

test.afterAll(async () => {
  await context?.close();
});

const listHits = () => hits.get(`GET uamanga.com/api/titles/${UA_SLUG}/chapters`) ?? 0;
const chip = (name: string) => page.locator('hikka-plus-chapters [role=tab], hikka-plus-chapters button').filter({ hasText: name }).first();

// hits — спільний для всіх спеків у процесі: рахуємо від значення на початку.
let base = 0;

test('неактивне джерело: один запит і «~N» на плашці', async () => {
  base = listHits();
  page = await context.newPage();
  await page.goto(`https://hikka.io/manga/${MANGA}`);
  // Активне — Zenko (пріоритетніше): його розділи в списку.
  await expect(page.locator('hikka-plus-chapters [role=listitem]')).toHaveCount(ZENKO_CHAPTERS, { timeout: 20_000 });
  await expect(chip('UAManga')).toContainText(`~${MANGA_CHAPTERS}`);
  await page.waitForTimeout(500);
  expect(listHits() - base).toBe(1); // лише перша сторінка (getLatest), повного списку не вантажили
});

test('клік по плашці — повний список цього джерела', async () => {
  await chip('UAManga').click();
  await expect(page.locator('hikka-plus-chapters [role=listitem]')).toHaveCount(MANGA_CHAPTERS, { timeout: 10_000 });
  await expect(chip('UAManga')).not.toContainText('~');
  expect(listHits() - base).toBe(2);
});
