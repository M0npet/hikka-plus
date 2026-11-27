/*
 * Фон: перевірка нових розділів (див. chapter-alerts.ts), сповіщення браузера; число на іконці — src/core/notify.ts.
 * Запити — ті самі функції джерел, що й на hikka.io (src/sources), але напряму з фону (net.ts, setDirectFetch):
 * той самий allowlist хостів, без cookie, пауза на хост після 429. Між тайтлами — GAP_MS.
 */
import { browser } from '#imports';
import { isRateLimit } from '../core/net';
import { hookNotes, notesApi } from '../core/notify';
import { applyReleased, latestChapters, summarize } from '../cards/released';
import { baka } from '../sources/baka';
import { dgManga } from '../sources/dgmanga';
import { honeyManga } from '../sources/honeymanga';
import { mangaInUa } from '../sources/mangainua';
import { uaManga } from '../sources/uamanga';
import { zenko } from '../sources/zenko';
import { CHAP_CHECK_MIN, chapCheckItem, chapsItem, getChapPrefs, pruneChaps, updateChaps, type ChapCheckResult } from './chapter-alerts';

/** Лише ті, що content script записує (getLatest або ONE_REQUEST у chapter-alerts.ts), — не весь registry: фон менший. */
const SOURCES = new Map([zenko, uaManga, honeyManga, baka, dgManga, mangaInUa].map((x) => [x.id, x]));

/** Джерела, що розбирають HTML (DOMParser): у фоні Chrome MV3 його немає — там їх не питаємо, щоб не писати «Не всі сайти відповіли». */
const NEEDS_DOM = new Set([baka.id]);
const hasDom = typeof DOMParser !== 'undefined';

const ALARM = 'hp-chaps';
const GAP_MS = 1500;
const NOTE_PREFIX = 'hp-ch:';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function onNoteClick(id: string) {
  if (!id.startsWith(NOTE_PREFIX)) return;
  const key = id.slice(NOTE_PREFIX.length);
  const i = key.indexOf(':');
  const url = i > 0 ? `https://hikka.io/${key.slice(0, i)}/${encodeURIComponent(key.slice(i + 1))}` : browser.runtime.getURL('/options.html#reader');
  void browser.tabs.create({ url });
}

type Fresh = { key: string; name: string; sn: string; n: number; added: number };

async function notify(fresh: Fresh[]) {
  const api = notesApi();
  if (!api || !fresh.length) return;
  const iconUrl = browser.runtime.getURL('/icon/128.png');
  try {
    if (fresh.length <= 3) {
      for (const f of fresh)
        await api.create(`${NOTE_PREFIX}${f.key}`, {
          type: 'basic',
          iconUrl,
          title: f.added > 1 ? `Нові розділи: ${f.added}` : 'Новий розділ',
          message: `${f.name}\n${f.sn} · розділ ${f.n}`,
        });
    } else {
      await api.create(NOTE_PREFIX, {
        type: 'basic',
        iconUrl,
        title: `Нові розділи: ${fresh.length} тайтлів`,
        message: fresh
          .slice(0, 4)
          .map((f) => `${f.name} — розділ ${f.n}`)
          .join('\n'),
      });
    }
  } catch {
    /* дозвіл забрали посеред перевірки */
  }
}

let running: Promise<ChapCheckResult> | null = null;

/** Перевірити всі тайтли. force — не дивитися на час останньої перевірки (кнопка «Перевірити зараз»). */
export function checkChaps(force = false): Promise<ChapCheckResult> {
  running ??= run(force).finally(() => (running = null));
  return running;
}

async function run(force: boolean): Promise<ChapCheckResult> {
  const prefs = await getChapPrefs();
  if (!prefs.on) return { ok: true, found: 0 };
  const now = Date.now();
  if (!force && now - (await chapCheckItem.getValue()) < (CHAP_CHECK_MIN - 5) * 60_000) return { ok: true, found: 0 };
  await chapCheckItem.setValue(now);

  const tracked = pruneChaps(await chapsItem.getValue(), now);
  const grown = new Map<string, number>();
  /** Те саме число — і для плашки «N нових розділів» на картках (local:hp:released). */
  const sums: Parameters<typeof applyReleased>[0] = [];
  let error: string | undefined;
  for (const [i, [key, t]] of Object.entries(tracked).entries()) {
    const src = SOURCES.get(t.s);
    if (!src || (!hasDom && NEEDS_DOM.has(src.id))) continue;
    if (i) await sleep(GAP_MS);
    try {
      const sum = summarize(await latestChapters(src, t.id), t.t);
      const max = sum.n;
      if (max) sums.push({ key, s: t.s, id: t.id, t: t.t, ...sum });
      if (max > t.n) grown.set(key, max);
    } catch (e) {
      // 429 — net.ts ставить паузу на хост: решта тайтлів того ж сайту в цьому проході не смикає його (одразу 429).
      error = isRateLimit(e) ? 'Сайт просить почекати — решту перевіримо наступного разу' : 'Не всі сайти відповіли';
    }
  }

  const fresh: Fresh[] = [];
  await updateChaps((m) => {
    for (const [key, max] of grown) {
      const t = m[key];
      if (!t || max <= t.n) continue; // користувач щойно відкрив тайтл — уже побачив
      fresh.push({ key, name: t.name, sn: t.sn, n: max, added: max - t.n });
      m[key] = { ...t, n: max, nu: now };
    }
    return pruneChaps(m, now);
  });
  await applyReleased(sums);
  // Число на іконці перерахує watchBadge (src/core/notify.ts), якщо список змінився.
  if (prefs.notify) await notify(fresh);
  return { ok: !error, found: fresh.length, error };
}

export function startChapAlerts() {
  void browser.alarms.get(ALARM).then((a) => {
    if (!a) void browser.alarms.create(ALARM, { delayInMinutes: 2, periodInMinutes: CHAP_CHECK_MIN });
  });
  browser.alarms.onAlarm.addListener((a) => {
    if (a.name === ALARM) void checkChaps();
  });
  hookNotes(onNoteClick);
}
