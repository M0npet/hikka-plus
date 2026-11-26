/*
 * Назви серій з Hikka (MK 2026-11-26 14:03, ідея 1 з research-hikka-github.md).
 * API: GET api.hikka.io/anime/{slug}/episodes?page&size=100 → {list: [{index, title_ua, title_en, title_ja, aired}], pagination},
 * без входу. Фронт Hikka цього не показує. Кешуємо в local: на тайтл (3 дні — в онгоінгах назви додаються),
 * тримаємо всі три мови — щоб мова назв користувача (ідея 4) не вимагала нового запиту.
 */
import { storage } from '#imports';
import { getJson } from '../core/net';
import { pickTitle, type TitleLang } from '../core/title-lang';

/** [укр, англ, яп] — порожні рядки, якщо назви немає. */
export type EpTitle = [string, string, string];
export type EpTitles = Record<number, EpTitle>;
type Saved = Record<string, { at: number; t: EpTitles }>;

const TTL_MS = 3 * 24 * 3600_000;
const MAX_TITLES = 60;
const MAX_PAGES = 20; // 2000 серій — більше не буває
const item = storage.defineItem<Saved>('local:hp:epTitles', { fallback: {} });

type Page = {
  list?: { index?: unknown; title_ua?: unknown; title_en?: unknown; title_ja?: unknown }[];
  pagination?: { pages?: number };
};

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

async function fetchTitles(slug: string): Promise<EpTitles> {
  const t: EpTitles = {};
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await getJson<Page>(`https://api.hikka.io/anime/${encodeURIComponent(slug)}/episodes?page=${page}&size=100`);
    for (const x of r.list ?? []) {
      const n = Number(x.index);
      const v: EpTitle = [str(x.title_ua), str(x.title_en), str(x.title_ja)];
      if (n > 0 && v.some(Boolean)) t[n] = v;
    }
    if ((r.pagination?.pages ?? 0) <= page) break;
  }
  return t;
}

const inflight = new Map<string, Promise<EpTitles>>();

/** Назви серій тайтлу: з кешу, застарів — з API (помилка — що є, або порожньо). */
export function getEpisodeTitles(slug: string): Promise<EpTitles> {
  let p = inflight.get(slug);
  if (p) return p;
  p = (async () => {
    const saved = await item.getValue();
    const hit = saved[slug];
    if (hit && Date.now() - hit.at < TTL_MS) return hit.t;
    try {
      const t = await fetchTitles(slug);
      const all = { ...(await item.getValue()), [slug]: { at: Date.now(), t } };
      // Найстаріші тайтли випадають.
      const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_TITLES);
      await item.setValue(Object.fromEntries(keep));
      return t;
    } catch {
      return hit?.t ?? {};
    }
  })().finally(() => setTimeout(() => inflight.delete(slug), 60_000));
  inflight.set(slug, p);
  return p;
}

/** Назва одним рядком мовою користувача Hikka (src/core/title-lang.ts). */
export const epTitleText = (v: EpTitle | undefined, lang: TitleLang) => (v ? pickTitle({ ua: v[0], en: v[1], ja: v[2] }, lang) : '');
