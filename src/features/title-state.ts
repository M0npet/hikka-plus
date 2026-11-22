import { useSyncExternalStore } from 'react';
import { fetchHikkaTitle, type HikkaTitle } from '../core/hikka';
import type { TitlePage } from '../core/page';
import {
  getBinding,
  getProgress,
  setBinding,
  watchProgress,
  type Progress,
} from '../core/store';
import { getSource, sourcesFor } from '../sources/registry';
import type { Chapter, ReadSource, RemoteTitle } from '../sources/types';

/**
 * Спільний стан поточного тайтлу: його читають кнопка «Читати»,
 * блок «Розділи» і читалка (усі живуть в одному content script).
 */
export interface TitleState {
  page: TitlePage;
  status: 'loading' | 'ready' | 'not-found' | 'error';
  hikka?: HikkaTitle;
  source?: ReadSource;
  remote?: RemoteTitle;
  manual?: boolean;
  chapters: Chapter[];
  progress: Progress | null;
  error?: string;
}

export interface ReaderRequest {
  chapterId: string;
  /** Відкрити з позиції збереженого прогресу. */
  resume: boolean;
}

type Listener = () => void;

class Store<T> {
  private listeners = new Set<Listener>();
  constructor(private value: T) {}
  get = () => this.value;
  set = (v: T) => {
    this.value = v;
    this.listeners.forEach((l) => l());
  };
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

export const titleStore = new Store<TitleState | null>(null);
export const readerStore = new Store<ReaderRequest | null>(null);

export const useTitleState = () => useSyncExternalStore(titleStore.subscribe, titleStore.get);
export const useReaderRequest = () => useSyncExternalStore(readerStore.subscribe, readerStore.get);

export const openReader = (chapterId: string, resume = false) =>
  readerStore.set({ chapterId, resume });
export const closeReader = () => readerStore.set(null);

let loadToken = 0;
let unwatchProgress: (() => void) | null = null;

function patch(token: number, p: Partial<TitleState>) {
  const cur = titleStore.get();
  if (token !== loadToken || !cur) return;
  titleStore.set({ ...cur, ...p });
}

async function loadChapters(token: number, source: ReadSource, remote: RemoteTitle, manual: boolean) {
  patch(token, { status: 'loading', source, remote, manual, chapters: [] });
  try {
    const chapters = await source.getChapters(remote.id);
    patch(token, { status: 'ready', chapters });
  } catch (e) {
    patch(token, { status: 'error', error: `Не вдалося завантажити розділи: ${String(e)}` });
  }
}

/** Завантажити все для сторінки тайтлу (викликається при кожному переході). */
export async function loadTitle(page: TitlePage) {
  const cur = titleStore.get();
  if (cur && cur.page.kind === page.kind && cur.page.slug === page.slug) return;

  const token = ++loadToken;
  unwatchProgress?.();
  closeReader();
  titleStore.set({ page, status: 'loading', chapters: [], progress: null });

  unwatchProgress = watchProgress(page.kind, page.slug, (p) => patch(token, { progress: p }));
  getProgress(page.kind, page.slug).then((p) => patch(token, { progress: p }));

  try {
    const hikka = await fetchHikkaTitle(page.kind, page.slug);
    patch(token, { hikka });

    const binding = await getBinding(page.kind, page.slug);
    const bound = binding && getSource(binding.sourceId);
    if (binding && bound) {
      const remote = await bound.getTitle(binding.remoteId).catch(
        (): RemoteTitle => ({
          id: binding.remoteId,
          title: binding.title,
          altTitles: [],
          format: page.kind === 'novel' ? 'novel' : 'manga',
          url: '',
        }),
      );
      return loadChapters(token, bound, remote, binding.manual);
    }

    for (const source of sourcesFor(page.kind)) {
      const remote = await source.autoMatch(hikka).catch(() => null);
      if (remote) {
        await setBinding(page.kind, page.slug, {
          sourceId: source.id,
          remoteId: remote.id,
          title: remote.title,
          manual: false,
        });
        return loadChapters(token, source, remote, false);
      }
    }
    patch(token, { status: 'not-found' });
  } catch (e) {
    patch(token, { status: 'error', error: String(e) });
  }
}

/** Ручна прив'язка до знайденого тайтлу. */
export async function bindManually(source: ReadSource, remote: RemoteTitle) {
  const cur = titleStore.get();
  if (!cur) return;
  await setBinding(cur.page.kind, cur.page.slug, {
    sourceId: source.id,
    remoteId: remote.id,
    title: remote.title,
    manual: true,
  });
  await loadChapters(loadToken, source, remote, true);
}

export function resetTitle() {
  loadToken++;
  unwatchProgress?.();
  unwatchProgress = null;
  closeReader();
  titleStore.set(null);
}

/** Розділ, з якого «Продовжити»: останній відкритий або наступний за прочитаним. */
export function continueTarget(s: TitleState): { chapter: Chapter; resume: boolean } | null {
  const first = s.chapters[0];
  if (!first) return null;
  const p = s.progress;
  if (p && p.sourceId === s.source?.id && p.remoteId === s.remote?.id && p.chapterId) {
    const i = s.chapters.findIndex((c) => c.id === p.chapterId);
    const cur = s.chapters[i];
    if (cur) {
      if (!p.read.includes(cur.id)) return { chapter: cur, resume: true };
      const after = s.chapters[i + 1];
      return after ? { chapter: after, resume: false } : { chapter: cur, resume: true };
    }
  }
  return { chapter: first, resume: false };
}
