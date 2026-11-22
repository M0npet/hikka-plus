import type { HikkaTitle } from '../core/hikka';
import type { ReadKind } from '../core/page';

/** Тип контенту на джерелі — впливає на режим читалки за замовчуванням. */
export type ContentFormat = 'novel' | 'manga' | 'webtoon';

export interface RemoteTitle {
  id: string;
  title: string;
  altTitles: string[];
  cover?: string;
  format: ContentFormat;
  chapterCount?: number;
  year?: number;
  url: string;
}

export interface Chapter {
  id: string;
  volume: string | null;
  number: string;
  /** Назва розділу, якщо є. */
  name?: string;
  team?: string;
  date?: number; // unix ms
  url: string;
}

export type ChapterContent =
  | { type: 'text'; html: string }
  | { type: 'images'; pages: { id: string; url: (quality: ImageQualityHint) => string }[] };

export type ImageQualityHint = 'original' | 'high' | 'medium' | 'low';

/**
 * Джерело читання. Щоб додати сайт — реалізуй цей інтерфейс,
 * зареєструй у registry.ts і додай API-хост у core/hosts.ts.
 */
export interface ReadSource {
  id: string;
  name: string;
  kinds: ReadKind[];
  search(query: string, kind: ReadKind): Promise<RemoteTitle[]>;
  /** Спроба знайти тайтл автоматично (за посиланням із Hikka або за назвою). */
  autoMatch(title: HikkaTitle): Promise<RemoteTitle | null>;
  getTitle(id: string): Promise<RemoteTitle>;
  getChapters(titleId: string): Promise<Chapter[]>;
  getContent(chapter: Chapter): Promise<ChapterContent>;
}

export function chapterLabel(c: Pick<Chapter, 'volume' | 'number' | 'name'>): string {
  const base = `${c.volume ? `Том ${c.volume} · ` : ''}Розділ ${c.number}`;
  return c.name ? `${base}: ${c.name}` : base;
}
