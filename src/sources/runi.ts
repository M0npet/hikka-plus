import { getDoc } from '../core/net';
import { autoMatchBy, bestSimilarity } from './match';
import type { Chapter, ReadSource, RemoteTitle } from './types';

// Runi: невелика бібліотека сянься/ранобе (≈20 тайтлів), серверні сторінки.
// Каталог беремо цілим із головної, розділи йдуть підряд 1..N (N — «перекладено»).
const SITE = 'https://runi.ink';

interface RCard {
  remote: RemoteTitle;
  translated: number;
}

let catalog: Promise<RCard[]> | null = null;

function loadCatalog(): Promise<RCard[]> {
  catalog ??= getDoc(`${SITE}/?sort=name`).then((doc) =>
    [...doc.querySelectorAll<HTMLAnchorElement>('a.novel-card')].map((a) => {
      const slug = a.dataset.slug ?? '';
      const img = a.querySelector('img')?.getAttribute('src');
      return {
        translated: Number(a.dataset.translated) || 0,
        remote: {
          id: slug,
          title: (a.dataset.name ?? slug).trim(),
          // Слаг — англійська назва («desolate-era» → «desolate era»).
          altTitles: [slug.replace(/-/g, ' ')],
          cover: img ? new URL(img, SITE).href : undefined,
          format: 'novel' as const,
          chapterCount: Number(a.dataset.translated) || undefined,
          url: `${SITE}/novel/${slug}`,
        },
      };
    }),
  );
  catalog.catch(() => (catalog = null));
  return catalog;
}

export const runi: ReadSource = {
  id: 'runi',
  name: 'Runi',
  kinds: ['novel'],

  async search(query) {
    const q = query.trim();
    if (!q) return [];
    const all = (await loadCatalog()).filter((c) => c.translated > 0);
    return all
      .map((c) => ({ c, s: bestSimilarity([c.remote.title, ...c.remote.altTitles], [q]) }))
      .filter((x) => x.s >= 0.3)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c.remote);
  },

  autoMatch(title) {
    return autoMatchBy(this, title, /runi\.ink\/novel\/([\w-]+)/);
  },

  async getTitle(id) {
    const card = (await loadCatalog()).find((c) => c.remote.id === id);
    if (!card) throw new Error('Тайтл не знайдено на Runi');
    return card.remote;
  },

  async getChapters(titleId) {
    // Свіжий каталог: кількість перекладених розділів могла зрости.
    catalog = null;
    const card = (await loadCatalog()).find((c) => c.remote.id === titleId);
    const n = card?.translated ?? 0;
    return Array.from({ length: n }, (_, i): Chapter => ({
      id: `${titleId}/${i + 1}`,
      volume: null,
      number: String(i + 1),
      url: `${SITE}/novel/${titleId}/chapter/${i + 1}`,
    }));
  },

  async getContent(chapter) {
    const doc = await getDoc(chapter.url);
    const text = doc.querySelector('.chapter-text');
    if (!text) throw new Error('Не знайшов текст розділу на Runi');
    return { type: 'text', html: text.innerHTML };
  },
};
