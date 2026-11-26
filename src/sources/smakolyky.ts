import { getJson } from '../core/net';
import { autoMatchBy } from './match';
import type { Chapter, ReadSource, RemoteTitle } from './types';

// «Смаколики» — команда перекладу ранобе з власним сайтом і відкритим JSON API.
const SITE = 'https://smakolykytl.site';
const API = 'https://api.smakolykytl.site/api/user';

interface SProject {
  id: number;
  title: string;
  alternatives?: string | null;
  release?: string | number | null;
  image?: { url?: string } | null;
}
interface SBook {
  id: number;
  rank: number;
  title: string;
  chapters: { id: number; title: string; rank: string; createdAt?: string }[];
}

const toRemote = (p: SProject): RemoteTitle => ({
  id: String(p.id),
  title: p.title.trim(),
  altTitles: (p.alternatives ?? '').split('/').map((s) => s.trim()).filter(Boolean),
  cover: p.image?.url ? encodeURI(p.image.url) : undefined,
  format: 'novel',
  year: Number(p.release) || undefined,
  url: `${SITE}/titles/${p.id}`,
});

// ---------- Текст розділу: документ редактора TipTap (JSON) → HTML ----------

interface TNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: TNode[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function render(nodes: TNode[] = []): string {
  return nodes.map(node).join('');
}

function node(n: TNode): string {
  switch (n.type) {
    case 'text': {
      let s = esc(n.text ?? '');
      for (const m of n.marks ?? []) {
        if (m.type === 'bold') s = `<b>${s}</b>`;
        else if (m.type === 'italic') s = `<i>${s}</i>`;
        else if (m.type === 'underline') s = `<u>${s}</u>`;
        else if (m.type === 'strike') s = `<s>${s}</s>`;
      }
      return s;
    }
    case 'paragraph':
      return `<p>${render(n.content)}</p>`;
    case 'heading': {
      const l = Math.min(Math.max(Number(n.attrs?.level) || 3, 2), 4);
      return `<h${l}>${render(n.content)}</h${l}>`;
    }
    case 'image':
      return typeof n.attrs?.src === 'string' ? `<img src="${esc(n.attrs.src)}" alt="">` : '';
    case 'hardBreak':
      return '<br>';
    case 'horizontalRule':
      return '<hr>';
    case 'blockquote':
      return `<blockquote>${render(n.content)}</blockquote>`;
    case 'bulletList':
      return `<ul>${render(n.content)}</ul>`;
    case 'orderedList':
      return `<ol>${render(n.content)}</ol>`;
    case 'listItem':
      return `<li>${render(n.content)}</li>`;
    default:
      return render(n.content);
  }
}

function tiptapToHtml(raw: unknown): string {
  let doc: unknown = raw;
  if (typeof raw === 'string') {
    try {
      doc = JSON.parse(raw);
    } catch {
      return `<p>${esc(raw)}</p>`;
    }
  }
  if (Array.isArray(doc)) return render(doc as TNode[]);
  if (doc && typeof doc === 'object') return render((doc as TNode).content);
  return '';
}

export const smakolyky: ReadSource = {
  id: 'smakolyky',
  name: 'Смаколики',
  kinds: ['novel'],

  async search(query) {
    const q = query.trim();
    if (!q) return [];
    const res = await getJson<{ projects: SProject[] }>(`${API}/projects/find/${encodeURIComponent(q)}`);
    return (res.projects ?? []).map(toRemote);
  },

  autoMatch(title) {
    return autoMatchBy(this, title, /smakolykytl\.site\/titles\/(\d+)/);
  },

  async getTitle(id) {
    const res = await getJson<{ project: SProject }>(`${API}/projects/${encodeURIComponent(id)}`);
    return toRemote(res.project);
  },

  async getChapters(titleId) {
    const res = await getJson<{ books: SBook[] }>(`${API}/projects/${encodeURIComponent(titleId)}/books`);
    const books = [...(res.books ?? [])].sort((a, b) => a.rank - b.rank);
    // Номери в томах повторюються, а прогрес рахується за номером —
    // тож нумеруємо наскрізь, а справжню назву показуємо поруч.
    let i = 0;
    const out: Chapter[] = [];
    for (const b of books) {
      for (const c of [...b.chapters].sort((x, y) => Number(x.rank) - Number(y.rank))) {
        out.push({
          id: String(c.id),
          volume: b.title.match(/\d+/)?.[0] ?? String(b.rank),
          number: String(++i),
          name: c.title?.trim() || undefined,
          date: c.createdAt ? Date.parse(c.createdAt) : undefined,
          url: `${SITE}/read/${c.id}`,
        });
      }
    }
    return out;
  },

  async getContent(chapter) {
    const res = await getJson<{ chapter?: { content?: unknown }; content?: unknown }>(`${API}/chapters/${chapter.id}`);
    const html = tiptapToHtml(res.chapter?.content ?? res.content);
    if (!html) throw new Error('Розділ порожній');
    return { type: 'text', html };
  },
};
