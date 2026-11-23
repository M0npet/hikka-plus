/*
 * Розклад серій для плашки «N серія через X дн.» (MK 18:26, як на Mikai).
 * API Hikka: POST /schedule/anime — майбутні серії всіх тайтлів за зростанням дати ({anime, episode, airing_at}),
 * без входу. Беремо 2 сторінки по 100 (≈ тиждень+, усі щотижневі онгоінги) раз на 3 години й тримаємо локально:
 * сама Hikka поля «наступна серія» в картках не віддає, а запит на кожну картку — дорого.
 */
import { storage } from '#imports';
import { postJson } from '../core/net';

/** slug → [номер наступної серії, час виходу (сек UTC)]. */
export type Schedule = Record<string, [number, number]>;
type Saved = { at: number; m: Schedule };

const TTL_MS = 3 * 3600_000;
const PAGES = 2;
const item = storage.defineItem<Saved | null>('local:hp:schedule', { fallback: null });

type Page = { list?: { anime?: { slug?: unknown }; episode?: unknown; airing_at?: unknown }[]; pagination?: { pages?: number } };

async function fetchSchedule(): Promise<Schedule> {
  const m: Schedule = {};
  const now = Date.now() / 1000;
  for (let page = 1; page <= PAGES; page++) {
    const r = await postJson<Page>(`https://api.hikka.io/schedule/anime?page=${page}&size=100`, { status: ['ongoing', 'announced'] });
    for (const x of r.list ?? []) {
      const slug = x.anime?.slug;
      const ep = Number(x.episode);
      const at = Number(x.airing_at);
      // Список за зростанням дати — перша майбутня серія тайтлу і є наступною.
      if (typeof slug === 'string' && ep > 0 && at > now && !m[slug]) m[slug] = [ep, at];
    }
    if ((r.pagination?.pages ?? 0) <= page) break;
  }
  return m;
}

let inflight: Promise<Schedule> | null = null;

/** Розклад із кешу; застарів (3 год) — оновити з API (при помилці — що є). */
export function getSchedule(): Promise<Schedule> {
  inflight ??= (async () => {
    const saved = await item.getValue();
    if (saved && Date.now() - saved.at < TTL_MS) return saved.m;
    try {
      const m = await fetchSchedule();
      await item.setValue({ at: Date.now(), m });
      return m;
    } catch {
      return saved?.m ?? {};
    }
  })().finally(() => {
    // Наступний виклик через TTL знову перевірить свіжість.
    setTimeout(() => (inflight = null), 60_000);
  });
  return inflight;
}
