import { storage } from '#imports';
import { useEffect, useState } from 'react';
import type { ReadKind } from './page';

// ---------- Налаштування читалки ----------

export type NovelTheme = 'site' | 'sepia' | 'light' | 'dark';
export type NovelFont = 'site' | 'serif' | 'sans' | 'mono';
export type MangaMode = 'vertical' | 'paged';
export type MangaFit = 'width' | 'height' | 'original';
export type ImageQuality = 'original' | 'high' | 'medium' | 'low';

export interface ReaderSettings {
  novel: {
    fontSize: number; // px
    lineHeight: number;
    width: number; // px
    font: NovelFont;
    theme: NovelTheme;
    justify: boolean;
    indent: boolean;
    paragraphGap: number; // em
  };
  manga: {
    /** Режим за замовчуванням: манґа — сторінки, манхва/маньхва — стрічка. */
    modeManga: MangaMode;
    modeWebtoon: MangaMode;
    rtl: boolean;
    fit: MangaFit;
    width: number; // px, для стрічки та «за шириною»
    gap: number; // px між сторінками стрічки
    brightness: number; // %
    quality: ImageQuality;
    clickArea: 'image' | 'screen';
    pageNumbers: boolean;
  };
  /** Ховати панелі при прокрутці вниз і показувати при прокрутці вгору. */
  autoHideBars: boolean;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  novel: {
    fontSize: 18,
    lineHeight: 1.7,
    width: 760,
    font: 'site',
    theme: 'site',
    justify: false,
    indent: false,
    paragraphGap: 0.9,
  },
  manga: {
    modeManga: 'paged',
    modeWebtoon: 'vertical',
    rtl: false,
    fit: 'width',
    width: 900,
    gap: 0,
    brightness: 100,
    quality: 'high',
    clickArea: 'image',
    pageNumbers: true,
  },
  autoHideBars: true,
};

const settingsItem = storage.defineItem<ReaderSettings>('local:hp:settings', {
  fallback: DEFAULT_SETTINGS,
});

function mergeSettings(s: Partial<ReaderSettings> | null | undefined): ReaderSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    novel: { ...DEFAULT_SETTINGS.novel, ...s?.novel },
    manga: { ...DEFAULT_SETTINGS.manga, ...s?.manga },
  };
}

export async function getSettings(): Promise<ReaderSettings> {
  return mergeSettings(await settingsItem.getValue());
}

export async function updateSettings(fn: (s: ReaderSettings) => ReaderSettings) {
  await settingsItem.setValue(fn(await getSettings()));
}

export function useSettings(): ReaderSettings {
  const [s, setS] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  useEffect(() => {
    let alive = true;
    getSettings().then((v) => alive && setS(v));
    const un = settingsItem.watch((v) => setS(mergeSettings(v)));
    return () => {
      alive = false;
      un();
    };
  }, []);
  return s;
}

// ---------- Прив'язка тайтлу Hikka до тайтлу на джерелі ----------

export interface Binding {
  sourceId: string;
  remoteId: string;
  title: string;
  /** true — користувач обрав вручну (автопідбір більше не чіпає). */
  manual: boolean;
}

const bindKey = (kind: ReadKind, slug: string) => `local:hp:bind:${kind}:${slug}` as const;

export const getBinding = (kind: ReadKind, slug: string) =>
  storage.getItem<Binding>(bindKey(kind, slug));
export const setBinding = (kind: ReadKind, slug: string, b: Binding | null) =>
  b ? storage.setItem(bindKey(kind, slug), b) : storage.removeItem(bindKey(kind, slug));

// ---------- Прогрес читання ----------

export interface Progress {
  sourceId: string;
  remoteId: string;
  /** Останній відкритий розділ. */
  chapterId: string;
  chapterLabel: string;
  /** Позиція в розділі: 0..1 для стрічки/тексту або номер сторінки (з 0). */
  position: number;
  /** Прочитані розділи (id на джерелі). */
  read: string[];
  updatedAt: number;
}

const progressKey = (kind: ReadKind, slug: string) => `local:hp:progress:${kind}:${slug}` as const;

export const getProgress = (kind: ReadKind, slug: string) =>
  storage.getItem<Progress>(progressKey(kind, slug));

export async function patchProgress(
  kind: ReadKind,
  slug: string,
  patch: Partial<Progress> & Pick<Progress, 'sourceId' | 'remoteId'>,
) {
  const cur = await getProgress(kind, slug);
  const base: Progress =
    cur && cur.sourceId === patch.sourceId && cur.remoteId === patch.remoteId
      ? cur
      : { ...patch, chapterId: '', chapterLabel: '', position: 0, read: [], updatedAt: 0 };
  await storage.setItem(progressKey(kind, slug), { ...base, ...patch, updatedAt: Date.now() });
}

export function watchProgress(kind: ReadKind, slug: string, cb: (p: Progress | null) => void) {
  return storage.watch<Progress>(progressKey(kind, slug), (v) => cb(v ?? null));
}
