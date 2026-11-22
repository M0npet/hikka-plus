import { getJson, getText } from '../core/net';
import { autoMatchBy } from './match';
import type { Chapter, ReadSource, RemoteTitle } from './types';

// Wattpad: сайт не український, але там багато українських перекладів ранобе.
// Беремо лише історії українською (language 46). Платні (isPaywalled) не показуємо.
const SITE = 'https://www.wattpad.com';
const UK = 46;

interface WStory {
  id: string;
  title: string;
  cover?: string;
  numParts?: number;
  isPaywalled?: boolean;
  language?: { id: number };
  parts?: WPart[];
}
interface WPart {
  id: number;
  title: string;
  createDate?: string;
  draft?: boolean;
  deleted?: boolean;
}

const STORY_FIELDS = 'id,title,cover,numParts,isPaywalled,language';

const toRemote = (s: WStory): RemoteTitle => {
  // Перекладачі часто пишуть «Назва / English title».
  const [main, ...rest] = s.title.split(/\s+\/\s+/);
  return {
    id: s.id,
    title: (main ?? s.title).trim(),
    altTitles: rest.map((t) => t.trim()).filter(Boolean),
    cover: s.cover,
    format: 'novel',
    chapterCount: s.numParts,
    url: `${SITE}/story/${s.id}`,
  };
};

const usable = (s: WStory) => s.language?.id === UK && !s.isPaywalled;

const numRe = /(?:глава|розділ|chapter|ch\.?)\s*(\d+(?:[.,]\d+)?)/i;
const volRe = /(?:том|volume|vol\.?)\s*(\d+)/i;

async function loadStory(id: string): Promise<WStory> {
  const s = await getJson<WStory>(
    `${SITE}/api/v3/stories/${encodeURIComponent(id)}?fields=${STORY_FIELDS},parts(id,title,createDate,draft,deleted)`,
  );
  if (s.isPaywalled) throw new Error('Платна історія Wattpad — читати лише на сайті');
  return s;
}

export const wattpad: ReadSource = {
  id: 'wattpad',
  name: 'Wattpad',
  kinds: ['novel'],

  async search(query) {
    const q = query.trim();
    if (!q) return [];
    const res = await getJson<{ stories: WStory[] }>(
      `${SITE}/api/v3/stories?query=${encodeURIComponent(q)}&language=${UK}&limit=20&fields=stories(${STORY_FIELDS})`,
    );
    return res.stories.filter(usable).map(toRemote);
  },

  autoMatch(title) {
    return autoMatchBy(this, title, /wattpad\.com\/story\/(\d+)/);
  },

  async getTitle(id) {
    return toRemote(await loadStory(id));
  },

  async getChapters(titleId) {
    const parts = ((await loadStory(titleId)).parts ?? []).filter((p) => !p.draft && !p.deleted);
    // Номер із назви частини («Том 1 Глава 3 - …»), якщо він є в усіх частинах; інакше — порядковий.
    const parsed = parts.map((p) => ({ n: p.title.match(numRe)?.[1]?.replace(',', '.'), v: p.title.match(volRe)?.[1] }));
    const byTitle = parsed.every((x) => x.n);
    return parts.map((p, i): Chapter => ({
      id: String(p.id),
      volume: byTitle ? (parsed[i]!.v ?? null) : null,
      number: byTitle ? parsed[i]!.n! : String(i + 1),
      // Том і номер уже показані — у назві лишаємо тільки решту («День, коли я став злим»).
      name: byTitle
        ? p.title.replace(volRe, '').replace(numRe, '').replace(/^[\s\-–—:.]+/, '').trim() || undefined
        : p.title.trim(),
      date: p.createDate ? Date.parse(p.createDate) : undefined,
      url: `${SITE}/${p.id}`,
    }));
  },

  async getContent(chapter) {
    const html = await getText(`${SITE}/apiv2/storytext?id=${encodeURIComponent(chapter.id)}`);
    if (!html.trim()) throw new Error('Не вдалося завантажити текст розділу з Wattpad');
    return { type: 'text', html };
  },
};
