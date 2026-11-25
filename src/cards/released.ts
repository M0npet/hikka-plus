/*
 * Скільки розділів вийшло на прив'язаному джерелі — для плашки «▶ N нових розділів» на картках манґи/ранобе (0.6.1, MK 2026-11-24 23:04).
 *
 *  - Запам'ятовуємо, коли користувач відкриває тайтл: активне джерело + обрана команда → найбільший номер розділу (`noteReleased`).
 *  - Оновлюємо лише те, що видно на сторінці зі статусом «Читаю» (`refreshReleased`, з content script): не частіше ніж раз на 3 год
 *    на тайтл, до 8 тайтлів за раз, одна вкладка за раз. Без прив'язки — нічого не знаємо, плашки немає.
 * Запити — ті самі, що й при відкритті тайтлу (через background, `credentials: 'omit'`); нових хостів немає.
 */
import { storage } from '#imports';
import type { ReadKind } from '../core/page';
import { getSource } from '../sources/registry';
import { renumberByVolume, type Chapter } from '../sources/types';

/** `<manga|novel>:<slug>` → що вийшло. */
export type Released = {
  /** Джерело, id тайтлу на ньому, команда ('' — усі). */
  s: string;
  id: string;
  t: string;
  /** Найбільший номер розділу (ціла частина). */
  n: number;
  /** Дата останнього розділу (ms), якщо джерело віддає. */
  d?: number;
  /** Коли перевіряли. */
  at: number;
};
export type ReleasedMap = Record<string, Released>;

const TTL_MS = 3 * 3600_000;
const BATCH = 8;
const MAX = 400;
export const releasedItem = storage.defineItem<ReleasedMap>('local:hp:released', { fallback: {} });
/** Щоб кілька вкладок hikka.io не перевіряли одне й те саме одночасно. */
const lockItem = storage.defineItem<number>('local:hp:releasedLock', { fallback: 0 });

export const bookKey = (kind: ReadKind, slug: string) => `${kind}:${slug}`;

/** Найбільший номер розділу й дата найновішого серед розділів команди. */
export function summarize(list: Chapter[], team: string): { n: number; d?: number } {
  let n = 0;
  let d = 0;
  for (const c of list) {
    if (team && c.team !== team) continue;
    const num = Math.floor(Number.parseFloat(String(c.number).replace(',', '.')));
    if (Number.isFinite(num) && num > n) n = num;
    if (c.date && c.date > d) d = c.date;
  }
  return d ? { n, d } : { n };
}

let queue: Promise<unknown> = Promise.resolve();
function patch(fn: (m: ReleasedMap) => ReleasedMap) {
  queue = queue.then(async () => {
    let m = fn({ ...(await releasedItem.getValue()) });
    const keys = Object.keys(m);
    if (keys.length > MAX) {
      // Найдавніше перевірені — геть.
      const keep = keys.sort((a, b) => m[b]!.at - m[a]!.at).slice(0, MAX);
      m = Object.fromEntries(keep.map((k) => [k, m[k]!]));
    }
    await releasedItem.setValue(m);
  }).catch(() => {});
  return queue;
}

/** Тайтл відкрито й розділи активного джерела завантажено. */
export function noteReleased(kind: ReadKind, slug: string, source: string, remoteId: string, team: string, chapters: Chapter[]) {
  if (!chapters.length) return;
  const sum = summarize(chapters, team);
  if (!sum.n) return;
  const key = bookKey(kind, slug);
  return patch((m) => {
    const p = m[key];
    if (p && p.s === source && p.id === remoteId && p.t === team && p.n === sum.n && p.d === sum.d && Date.now() - p.at < 60_000) return m;
    m[key] = { s: source, id: remoteId, t: team, ...sum, at: Date.now() };
    return m;
  });
}

let busy = false;

/** Перевірити застарілі тайтли «Читаю», які зараз видно на сторінці. */
export async function refreshReleased(keys: string[]) {
  if (busy || !keys.length) return;
  const m = await releasedItem.getValue();
  const now = Date.now();
  const stale = keys.filter((k) => m[k] && now - m[k].at > TTL_MS).slice(0, BATCH);
  if (!stale.length) return;
  if (now - (await lockItem.getValue()) < 60_000) return;
  busy = true;
  await lockItem.setValue(now);
  try {
    for (const key of stale) {
      const r = m[key]!;
      const src = getSource(r.s);
      let next: Released = { ...r, at: Date.now() };
      try {
        if (src) next = { ...next, ...summarize(renumberByVolume(await src.getChapters(r.id)), r.t) };
      } catch {
        /* сайт не відповів — спробуємо через 3 год, старе число лишаємо */
      }
      await patch((x) => (x[key] ? { ...x, [key]: next } : x));
    }
  } finally {
    busy = false;
    await lockItem.setValue(0);
  }
}
