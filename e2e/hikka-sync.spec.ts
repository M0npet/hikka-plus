/*
 * E2E «Відмічати в Hikka» (MK 2026-11-26 21:20: «тебе точно надо, чтобы я логинился?»). Вхід імітуємо: токен і дозвіл
 * на список перегляду кладемо у сховище фону, api.hikka.io — мок (e2e/mock.ts). Перевіряємо: дійшли до порогу серії 1 →
 * один PUT /watch/{slug} з episodes 1 «Дивлюсь»; остання серія → «Переглянуто»; без входу в Hikka нічого не йде.
 */
import { chromium, expect, test, type BrowserContext, type Frame, type Page, type Worker } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { SLUG, hits, installMock, mockState } from './mock';

const EXT = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));

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
  mockState.hikkaWatch = null;
  mockState.hikkaPuts = [];
  await context?.close();
});

const watch = () => page.locator('hikka-plus-watch');
const PUT = `PUT api.hikka.io/watch/${SLUG}`;

async function fenixFrame(n: number): Promise<Frame> {
  await expect.poll(() => page.frames().some((f) => f.url().startsWith(`https://fenixplay.xyz/vod/test-${n}`)), { timeout: 15_000 }).toBe(true);
  return page.frames().find((f) => f.url().startsWith(`https://fenixplay.xyz/vod/test-${n}`))!;
}
const tick = (f: Frame, t: number) => f.evaluate((t) => (window as unknown as { __tick: (t: number) => void }).__tick(t), t);

test('без входу в Hikka — серія відмічається лише в нас, у Hikka нічого не йде', async () => {
  page = await context.newPage();
  await page.goto(`https://hikka.io/anime/${SLUG}`);
  const f = await fenixFrame(1);
  await tick(f, 1300);
  await expect(watch().locator('.hp-watch__grid .hp-watch__ep').first()).toHaveAttribute('title', /переглянуто/, { timeout: 10_000 });
  await page.waitForTimeout(500);
  expect(hits.get(PUT)).toBeUndefined();
  expect(hits.get(`GET api.hikka.io/watch/${SLUG}`)).toBeUndefined();
  await page.close();
});

test('вхід у Hikka: поріг серії 1 → PUT episodes 1 «Дивлюсь»; остання серія → «Переглянуто»', async () => {
  await sw.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    // Наші відмітки з попереднього тесту — геть, щоб почати з серії 1.
    await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('hp:watch') && k !== 'hp:watchPrefs'));
    await chrome.storage.sync.clear();
    await chrome.storage.local.set({
      'hp:hikkaToken': { secret: 'e2e-token', expiration: Math.floor(Date.now() / 1000) + 3600 },
      'hp:hikkaWatchScope': true,
    });
  });
  page = await context.newPage();
  await page.goto(`https://hikka.io/anime/${SLUG}`);
  const f1 = await fenixFrame(1);
  await expect.poll(() => hits.get(`GET api.hikka.io/watch/${SLUG}`) ?? 0, { timeout: 10_000 }).toBeGreaterThan(0);
  await tick(f1, 600);
  await page.waitForTimeout(500);
  expect(hits.get(PUT)).toBeUndefined();
  await tick(f1, 1300);
  await expect.poll(() => mockState.hikkaPuts.length, { timeout: 10_000 }).toBe(1);
  expect(mockState.hikkaPuts[0]).toMatchObject({ episodes: 1, status: 'watching' });
  // Позиція йде далі — повторних записів немає.
  await tick(f1, 1310);
  await tick(f1, 1320);
  await page.waitForTimeout(800);
  expect(mockState.hikkaPuts.length).toBe(1);

  await watch().locator('.hp-watch__grid .hp-watch__ep').nth(1).click();
  const f2 = await fenixFrame(2);
  await tick(f2, 1300);
  await expect.poll(() => mockState.hikkaPuts.length, { timeout: 10_000 }).toBe(2);
  expect(mockState.hikkaPuts[1]).toMatchObject({ episodes: 2, status: 'completed' });
});
