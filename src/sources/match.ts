import { titleNames, type HikkaTitle } from '../core/hikka';
import type { RemoteTitle } from './types';
/** Нормалізація назви для порівняння: нижній регістр, лише літери й цифри. */
export function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .toLocaleLowerCase('uk-UA')
    .replace(/[ʼ'’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function words(s: string): Set<string> {
  return new Set(normalize(s).split(' ').filter(Boolean));
}

/** Схожість двох назв 0..1 (1 — збіг після нормалізації). */
export function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const wa = words(a);
  const wb = words(b);
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  const jaccard = common / (wa.size + wb.size - common);
  const contains = na.includes(nb) || nb.includes(na) ? 0.85 : 0;
  return Math.max(jaccard, contains * Math.min(na.length, nb.length) / Math.max(na.length, nb.length) + 0.1);
}

/** Найкращий збіг між будь-якою назвою з одного списку та будь-якою з іншого. */
export function bestSimilarity(a: string[], b: string[]): number {
  let best = 0;
  for (const x of a) for (const y of b) best = Math.max(best, similarity(x, y));
  return Math.min(best, 1);
}

/**
 * Типовий автопідбір: спершу посилання на джерело в блоці «Читати» на Hikka,
 * потім пошук за кількома назвами й вибір найсхожішої (≥ 0.8).
 */
export async function autoMatchBy(
  src: {
    search(q: string, kind: HikkaTitle['kind']): Promise<RemoteTitle[]>;
    getTitle(id: string): Promise<RemoteTitle>;
  },
  title: HikkaTitle,
  linkRe?: RegExp,
): Promise<RemoteTitle | null> {
  if (linkRe) {
    for (const ext of title.external) {
      const m = ext.url.match(linkRe);
      if (m?.[1]) {
        try {
          return await src.getTitle(decodeURIComponent(m[1]));
        } catch {
          /* посилання застаріло — шукаємо за назвою */
        }
      }
    }
  }
  const names = titleNames(title);
  let best: { t: RemoteTitle; score: number } | null = null;
  for (const q of names.slice(0, 3)) {
    let found: RemoteTitle[];
    // Без розділових знаків: пошук деяких сайтів (Honey) нічого не знаходить за «I'm the …».
    const query = q.replace(/[^\p{L}\p{N}]+/gu, ' ').trim() || q;
    try {
      found = await src.search(query, title.kind);
    } catch {
      continue;
    }
    for (const t of found.slice(0, 10)) {
      let score = bestSimilarity([t.title, ...t.altTitles], names);
      if (title.year && t.year && Math.abs(title.year - t.year) > 1) score -= 0.15;
      if (!best || score > best.score) best = { t, score };
    }
    if (best && best.score >= 0.98) break;
  }
  return best && best.score >= 0.8 ? best.t : null;
}

/** Номер розділу для сортування. */
export const chapterNum = (s: string | null | undefined) =>
  s == null ? 0 : Number.parseFloat(String(s).replace(',', '.')) || 0;
