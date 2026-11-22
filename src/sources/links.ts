import { titleNames, type HikkaTitle } from '../core/hikka';
import { getDoc, getJson, postJson } from '../core/net';
import type { ReadKind } from '../core/page';
import { bestSimilarity } from './match';

/**
 * Джерела-посилання: сайти із захищеною читалкою (токени, nonce, Referer, вхід).
 * Читати всередині Hikka Plus їх не можна — лише знайти тайтл і показати кнопку «Відкрити на …».
 * Захист сайтів не обходимо: беремо тільки публічний пошук/каталог.
 */
export interface LinkResult {
  url: string;
  title?: string;
  /** Скільки розділів (або «Розділ N»), якщо сайт це віддає публічно. */
  chapters?: string;
  /** Точний збіг (сайт сам прив'язав тайтл до Hikka). */
  exact?: boolean;
  /** Це лише посилання на пошук на сайті, а не на сторінку тайтлу. */
  search?: boolean;
}

export interface LinkSource {
  id: string;
  name: string;
  kinds: ReadKind[];
  find(title: HikkaTitle): Promise<LinkResult | null>;
}

const MIN_SCORE = 0.85;

/** Посилання на сайт, яке вже стоїть у блоці «Читати» на Hikka (додали люди) — точний збіг. */
function fromHikka(t: HikkaTitle, host: RegExp): LinkResult | null {
  const ext = t.external.find((e) => {
    try {
      return host.test(new URL(e.url).host);
    } catch {
      return false;
    }
  });
  return ext ? { url: ext.url, exact: true } : null;
}

// ---------- Mangra: у кожного тайтлу є hikkaSlug → точний збіг ----------

interface MangraRow {
  slug: string;
  title: string;
  altTitle?: string | null;
  hikkaSlug?: string | null;
  stats_chapters?: number | null;
}

const MANGRA = 'https://mangra.app';
let mangraList: Promise<MangraRow[]> | null = null;

function mangraRows(): Promise<MangraRow[]> {
  if (!mangraList) {
    mangraList = postJson<{ rows: MangraRow[] }>(`${MANGRA}/api/titles/list`, { limit: 500 }).then(
      (r) => r.rows ?? [],
    );
    mangraList.catch(() => (mangraList = null));
  }
  return mangraList;
}

const mangra: LinkSource = {
  id: 'mangra',
  name: 'Mangra',
  kinds: ['manga', 'novel'],
  async find(t) {
    const linked = fromHikka(t, /(^|\.)mangra\.app$/);
    const rows = await mangraRows();
    const exact = rows.find((r) => r.hikkaSlug === t.slug);
    const names = titleNames(t);
    const row =
      exact ??
      rows
        .map((r) => ({ r, s: bestSimilarity([r.title, r.altTitle ?? ''].filter(Boolean), names) }))
        .filter((x) => x.s >= MIN_SCORE && !x.r.hikkaSlug)
        .sort((a, b) => b.s - a.s)[0]?.r;
    if (!row) return linked;
    return {
      url: `${MANGRA}/title/${row.slug}`,
      title: row.title,
      chapters: row.stats_chapters ? `${row.stats_chapters} розд.` : undefined,
      exact: !!exact,
    };
  },
};

// ---------- FAUST: публічний пошук /api/titles/search ----------

const FAUST = 'https://faust-web.com';

interface FaustHit {
  slug: string;
  name: string;
}

interface FaustTitle {
  originalName?: string | null;
  englishName?: string | null;
  additionalTitles?: string[] | null;
  translatedChaptersCount?: number | null;
}

const faust: LinkSource = {
  id: 'faust',
  name: 'FAUST',
  kinds: ['manga'],
  async find(t) {
    const linked = fromHikka(t, /(^|\.)faust-web\.com$/);
    if (linked) return linked;
    const names = titleNames(t);
    let best: { slug: string; name: string; s: number } | null = null;
    for (const q of names.slice(0, 3)) {
      const res = await getJson<{ results?: FaustHit[] }>(
        `${FAUST}/api/titles/search?query=${encodeURIComponent(q)}&limit=8`,
      ).catch(() => null);
      for (const h of (res?.results ?? []).slice(0, 4)) {
        let s = bestSimilarity([h.name], names);
        if (s < 0.98) {
          // Пошук віддає лише укр. назву — інші назви беремо з картки тайтлу.
          const d = await getJson<FaustTitle>(`${FAUST}/api/titles/${encodeURIComponent(h.slug)}`).catch(() => null);
          const all = [d?.originalName, d?.englishName, ...(d?.additionalTitles ?? [])].filter(
            (x): x is string => !!x?.trim(),
          );
          if (all.length) s = Math.max(s, bestSimilarity(all, names));
        }
        if (!best || s > best.s) best = { slug: h.slug, name: h.name.trim(), s };
        if (s >= 0.98) break;
      }
      if (best && best.s >= 0.98) break;
    }
    if (!best || best.s < MIN_SCORE) return null;
    const d = await getJson<FaustTitle>(`${FAUST}/api/titles/${best.slug}`).catch(() => null);
    return {
      url: `${FAUST}/manga/${best.slug}`,
      title: best.name,
      chapters: d?.translatedChaptersCount ? `${d.translatedChaptersCount} розд.` : undefined,
    };
  },
};

// ---------- Mangarama (WordPress Madara): публічна сторінка пошуку ----------

const MANGARAMA = 'https://mangarama.com.ua';

const mangarama: LinkSource = {
  id: 'mangarama',
  name: 'Mangarama',
  kinds: ['manga'],
  async find(t) {
    const linked = fromHikka(t, /(^|\.)mangarama\.com\.ua$/);
    if (linked) return linked;
    const names = titleNames(t);
    let best: { url: string; title: string; chapters?: string; s: number } | null = null;
    for (const q of names.slice(0, 3)) {
      const doc = await getDoc(`${MANGARAMA}/?s=${encodeURIComponent(q)}&post_type=wp-manga`).catch(() => null);
      if (!doc) continue;
      for (const el of doc.querySelectorAll('.c-tabs-item__content')) {
        const a = el.querySelector<HTMLAnchorElement>('.post-title a');
        const href = a?.getAttribute('href');
        if (!a || !href?.startsWith(MANGARAMA)) continue;
        const title = a.textContent?.trim() ?? '';
        const alt = (el.querySelector('.mg_alternative .summary-content')?.textContent ?? '')
          .split(/[·,;/]/)
          .map((x) => x.trim())
          .filter(Boolean);
        const s = bestSimilarity([title, ...alt], names);
        const latest = el.querySelector('.latest-chap .chapter a')?.textContent?.trim();
        if (!best || s > best.s) best = { url: href, title, chapters: latest || undefined, s };
      }
      if (best && best.s >= 0.98) break;
    }
    if (!best || best.s < MIN_SCORE) return null;
    return { url: best.url, title: best.title, chapters: best.chapters };
  },
};

// ---------- Dengeki: API закритий — лише посилання на пошук у каталозі ----------

const dengeki: LinkSource = {
  id: 'dengeki',
  name: 'Dengeki',
  kinds: ['manga', 'novel'],
  async find(t) {
    const linked = fromHikka(t, /(^|\.)dengeki\.one$/);
    if (linked) return linked;
    const q = t.title_ua || t.title_en || t.title_original;
    if (!q) return null;
    return {
      url: `https://www.dengeki.one/catalog?search=${encodeURIComponent(q)}#search`,
      search: true,
    };
  },
};

export const LINK_SOURCES: LinkSource[] = [mangra, faust, mangarama, dengeki];
export const linkSourcesFor = (kind: ReadKind) => LINK_SOURCES.filter((s) => s.kinds.includes(kind));
