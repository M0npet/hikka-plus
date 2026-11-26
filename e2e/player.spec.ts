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

  // Озвучка — у лівій панелі поверх плеєра (рядка над плеєром немає; панель видно при русі миші).
  await expect(watch().locator('.hp-watch__tools--left').getByText(TEAM)).toHaveCount(1, { timeout: 20_000 });
  await expect(watch().locator('.hp-watch__bar')).toHaveCount(0);
  // Відео ще не пустили — наші панелі видно й без руху миші (MK 2026-11-26 15:41).
  await expect(watch().locator('.hp-watch__tools--left')).toHaveClass(/hp-watch__tools--on/);
  // Плеєр — на лівій панелі поряд з озвучкою (видно завжди, навіть коли плеєр один).
  await expect(watch().locator('.hp-watch__tools--left .hp-watch__toolplayer')).toContainText('Fenix');
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
  // Відео йде, миша не рухається — панелі ховаються.
  await expect(watch().locator('.hp-watch__tools--left')).not.toHaveClass(/hp-watch__tools--on/, { timeout: 5_000 });
  await expect(next.locator('.hp-ob__sub')).toHaveText(EP_TITLES[2]);
  await next.click();
  await fenixFrame(2);
  await expect(watch().locator('.hp-watch__eptitle')).toHaveText(EP_TITLES[2], { timeout: 10_000 });
});

test('меню серій над плеєром: «Відмічати» знімає й ставить відмітку', async () => {
  await fenixFrame(2);
  // Панель з'являється від руху миші в плеєрі (фрейм шле {active}).
  const box = (await watch().locator('.hp-watch__frame').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 10);
  const left = watch().locator('.hp-watch__tools--left');
  await expect(left).toHaveClass(/hp-watch__tools--on/, { timeout: 10_000 });
  // Миша на нашій панелі — плеєр отримує рух миші ({hold}), щоб не ховати свою панель (MK 2026-11-26 15:26).
  const f = await fenixFrame(2);
  await f.evaluate(() => {
    const w = window as unknown as { __moves: number };
    w.__moves = 0;
    document.addEventListener('mousemove', (e) => void (!e.isTrusted && w.__moves++), true);
  });
  const lb = (await left.boundingBox())!;
  await page.mouse.move(lb.x + 10, lb.y + lb.height / 2);
  await expect.poll(() => f.evaluate(() => (window as unknown as { __moves: number }).__moves), { timeout: 5_000 }).toBeGreaterThan(1);
  // Повернулися в сам кадр (справжній рух у плеєрі → {active: 1}) — більше не імітуємо рух.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2 + 15, box.y + box.height / 2 + 5);
  const moves = () => f.evaluate(() => (window as unknown as { __moves: number }).__moves);
  const m0 = await moves();
  await page.waitForTimeout(2_200);
  expect(await moves()).toBe(m0);
  await page.mouse.move(lb.x + 10, lb.y + lb.height / 2);
  // Туди-сюди через край панелі (лінія в 1 px, MK 16:06): повернення з кадру на наш шар браузер подіями не повідомляє,
  // але фрейм бачить mouseleave → {active: 0} → hikka.io дивиться :hover і одразу шле {hold}.
  // (Chromium під CDP mouseleave у фреймі не шле — імітуємо його, як у справжньому браузері.)
  await page.waitForTimeout(150);
  for (let i = 0; i < 3; i++) {
    await page.mouse.move(lb.x + 10, lb.y + lb.height + 12);
    await page.waitForTimeout(350); // фрейм побачив справжній рух → {active: 1} → відпустили
    const before = await moves();
    await page.mouse.move(lb.x + 10, lb.y + lb.height - 6);
    await f.evaluate(() => document.documentElement.dispatchEvent(new MouseEvent('mouseleave')));
    await expect.poll(moves, { timeout: 300, intervals: [50] }).toBeGreaterThan(before);
    await page.waitForTimeout(150);
  }
  await left.locator('.hp-watch__tool--ep').click();
  const menu = watch().locator('.hp-watch__eppop');
  await menu.locator('.hp-watch__epmark').click();
  const cell1 = menu.locator('.hp-watch__epcell').first();
  // Серію 1 зарахувало на попередньому кроці (поріг) — знімаємо, потім ставимо знову; меню не закривається.
  await expect(cell1).toHaveAttribute('aria-pressed', 'true');
  await cell1.click();
  await expect(cell1).toHaveAttribute('aria-pressed', 'false');
  await cell1.click();
  await expect(cell1).toHaveAttribute('aria-pressed', 'true');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
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
