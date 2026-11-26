/*
 * Наступний сезон (MK 2026-11-26 14:03, ідея 2 з research-hikka-github.md).
 * API: GET api.hikka.io/related/anime/{slug}/franchise → {relations: [{slug, related_slug, relation_type, content_type,
 * related_content_type}], anime: [{slug, title_ua, title_en, title_ja, status, …}]}, без входу.
 * Перевірено 2026-11-26 на «Фрірен»: {slug: <1 сезон>, related_slug: <2 сезон>, relation_type: 'sequel'} —
 * related_slug і є продовженням для slug. Кеш у local: на тайтл (3 дні). Без React — бере й віконце картки.
 */
import { storage } from '#imports';
import { getJson, HttpError } from '../core/net';
import { pickTitle, type TitleLang } from '../core/title-lang';

export type Sequel = {
  slug: string;
  /** [укр, англ, яп]. */
  title: [string, string, string];
  /** Анонс — серій ще немає. */
  soon: boolean;
};
type Saved = Record<string, { at: number; s: Sequel | null }>;

const TTL_MS = 3 * 24 * 3600_000;
const MAX_TITLES = 100;
const item = storage.defineItem<Saved>('local:hp:sequels', { fallback: {} });

type Franchise = {
  relations?: { slug?: unknown; related_slug?: unknown; relation_type?: unknown; content_type?: unknown; related_content_type?: unknown }[];
  anime?: { slug?: unknown; title_ua?: unknown; title_en?: unknown; title_ja?: unknown; status?: unknown }[];
};

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Продовження тайтлу з відповіді franchise (лише аніме → аніме). */
function sequelOf(slug: string, f: Franchise): Sequel | null {
  const rel = (f.relations ?? []).find(
    (r) => r.relation_type === 'sequel' && r.slug === slug && r.content_type === 'anime' && r.related_content_type === 'anime',
  );
  const to = str(rel?.related_slug);
  if (!to) return null;
  const a = (f.anime ?? []).find((x) => x.slug === to);
  return { slug: to, title: [str(a?.title_ua), str(a?.title_en), str(a?.title_ja)], soon: a?.status === 'announced' };
}

const inflight = new Map<string, Promise<Sequel | null>>();

/** Наступний сезон: з кешу, застарів — з API (помилка — що є, або null). */
export function getSequel(slug: string): Promise<Sequel | null> {
  let p = inflight.get(slug);
  if (p) return p;
  p = (async () => {
    const hit = (await item.getValue())[slug];
    if (hit && Date.now() - hit.at < TTL_MS) return hit.s;
    try {
      let s: Sequel | null;
      try {
        s = sequelOf(slug, await getJson<Franchise>(`https://api.hikka.io/related/anime/${encodeURIComponent(slug)}/franchise`));
      } catch (e) {
        // 400 «no-franchise» — у тайтлу немає франшизи: теж відповідь, кешуємо.
        if (!(e instanceof HttpError && e.status === 400)) throw e;
        s = null;
      }
      const all = { ...(await item.getValue()), [slug]: { at: Date.now(), s } };
      const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_TITLES);
      await item.setValue(Object.fromEntries(keep));
      return s;
    } catch {
      return hit?.s ?? null;
    }
  })().finally(() => setTimeout(() => inflight.delete(slug), 60_000));
  inflight.set(slug, p);
  return p;
}

/** Назва одним рядком мовою користувача Hikka (src/core/title-lang.ts). */
export const sequelTitle = (s: Sequel, lang: TitleLang) => pickTitle({ ua: s.title[0], en: s.title[1], ja: s.title[2] }, lang) || s.slug;
