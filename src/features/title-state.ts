import { useSyncExternalStore } from 'react';
import { fetchHikkaTitle, type HikkaTitle } from '../core/hikka';
import type { TitlePage } from '../core/page';
import {
  chapterKey,
  getBinding,
  getBindingSynced,
  getProgress,
  patchBinding,
  syncProgress,
  updateProgress,
  watchProgress,
  type Progress,
} from '../core/store';
import { getSource, sourcesFor } from '../sources/registry';
import { renumberByVolume, type Chapter, type ContentFormat, type ReadSource, type RemoteTitle } from '../sources/types';
import { loadRemoteRead, queueHikkaChapters, resetRemoteRead } from './hikka-sync';

/**
 * Спільний стан поточного тайтлу: його читають кнопка «Читати»,
 * блок «Розділи» і читалка (усі живуть в одному content script).
 */
export interface SourceState {
  status: 'searching' | 'loading' | 'ready' | 'not-found' | 'error';
  remote?: RemoteTitle;
  manual?: boolean;
  chapters: Chapter[];
  error?: string;
}

export interface TitleState {
  page: TitlePage;
  hikka?: HikkaTitle;
  hikkaError?: string;
  sources: Record<string, SourceState>;
  /** Активне джерело (обране користувачем або перше знайдене). */
  activeId: string | null;
  /** Чи обирав користувач джерело сам. */
  activeChosen: boolean;
  /** Обрана команда для кожного джерела ('' — усі). */
  teams: Record<string, string>;
  progress: Progress;
}

export interface ReaderRequest {
  sourceId: string;
  chapterId: string;
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

// ---------- Похідні значення ----------

export const activeSource = (s: TitleState): ReadSource | undefined =>
  s.activeId ? getSource(s.activeId) : undefined;
export const activeState = (s: TitleState): SourceState | undefined =>
  s.activeId ? s.sources[s.activeId] : undefined;
export const activeTeam = (s: TitleState) => (s.activeId ? (s.teams[s.activeId] ?? '') : '');

/** Розділи активного джерела з урахуванням обраної команди. */
export function visibleChapters(s: TitleState): Chapter[] {
  const all = activeState(s)?.chapters ?? [];
  const team = activeTeam(s);
  return team ? all.filter((c) => c.team === team) : all;
}

/** Загальний статус для кнопки/блоку. */
export function overallStatus(s: TitleState): 'loading' | 'ready' | 'not-found' | 'error' {
  if (s.hikkaError) return 'error';
  const act = activeState(s);
  if (act && act.status !== 'not-found') return act.status === 'ready' ? 'ready' : act.status === 'error' ? 'error' : 'loading';
  const all = Object.values(s.sources);
  if (!s.hikka || all.some((x) => x.status === 'searching' || x.status === 'loading')) return 'loading';
  return 'not-found';
}

/** Формат читалки: за типом тайтлу на Hikka, інакше — за джерелом. */
export function contentFormat(s: TitleState): ContentFormat {
  if (s.page.kind === 'novel') return 'novel';
  const t = s.hikka?.media_type ?? '';
  if (/manhwa|manhua/.test(t)) return 'webtoon';
  if (t) return 'manga';
  return activeState(s)?.remote?.format ?? 'manga';
}

export function chapterProgress(p: Progress, c: Chapter) {
  return p.chapters[chapterKey(c.number)];
}

/** Прогрес тайтлу: скільки унікальних номерів розділів прочитано. */
export function titleProgress(s: TitleState) {
  const keys = new Set(visibleChapters(s).map((c) => chapterKey(c.number)));
  let read = 0;
  for (const k of keys) if (s.progress.chapters[k]?.read) read++;
  return { read, total: keys.size };
}

/** Сусідній розділ за номером (з тієї ж команди, якщо можна). */
export function neighbor(list: Chapter[], cur: Chapter, dir: -1 | 1): Chapter | undefined {
  const keys = [...new Set(list.map((c) => chapterKey(c.number)))];
  const i = keys.indexOf(chapterKey(cur.number));
  const key = keys[i + dir];
  if (i < 0 || key === undefined) return undefined;
  const same = list.filter((c) => chapterKey(c.number) === key);
  return same.find((c) => c.team === cur.team) ?? same[0];
}

/** Розділ для «Продовжити»: незакінчений останній, інакше наступний за ним, інакше перший. */
export function continueTarget(s: TitleState): Chapter | null {
  const list = visibleChapters(s);
  const first = list[0];
  if (!first) return null;
  const last = s.progress.last;
  if (last) {
    const cur =
      list.find((c) => c.id === last.chapterId) ?? list.find((c) => chapterKey(c.number) === last.key);
    if (cur) {
      if (!s.progress.chapters[last.key]?.read) return cur;
      return neighbor(list, cur, 1) ?? cur;
    }
  }
  return list.find((c) => !s.progress.chapters[chapterKey(c.number)]?.read) ?? first;
}

// ---------- Завантаження ----------

const MISS_TTL = 3 * 24 * 3600 * 1000; // «не знайдено» перевіряємо знову через 3 дні

let loadToken = 0;
let unwatch: (() => void) | null = null;
let unwatchSync: (() => void) | null = null;

function patch(token: number, fn: (s: TitleState) => TitleState) {
  const cur = titleStore.get();
  if (token !== loadToken || !cur) return;
  titleStore.set(fn(cur));
}

const setSource = (token: number, id: string, p: Partial<SourceState>) =>
  patch(token, (s) => ({
    ...s,
    sources: { ...s.sources, [id]: { ...(s.sources[id] ?? { status: 'searching', chapters: [] }), ...p } },
  }));

async function loadChapters(token: number, source: ReadSource, remote: RemoteTitle, manual: boolean) {
  setSource(token, source.id, { status: 'loading', remote, manual, chapters: [], error: undefined });
  try {
    const chapters = renumberByVolume(await source.getChapters(remote.id));
    setSource(token, source.id, { status: 'ready', chapters });
  } catch (e) {
    setSource(token, source.id, { status: 'error', error: `Не вдалося завантажити розділи: ${String(e)}` });
  }
}

/** Якщо користувач не обирав джерело — активним стає найпріоритетніше знайдене. */
function pickActive(token: number) {
  patch(token, (s) => {
    if (s.activeChosen && s.activeId && s.sources[s.activeId]?.status !== 'not-found') return s;
    const order = sourcesFor(s.page.kind).map((x) => x.id);
    for (const id of order) {
      const st = s.sources[id];
      if (!st || st.status === 'searching') return s; // чекаємо пріоритетніше джерело
      if (st.status !== 'not-found') return s.activeId === id ? s : { ...s, activeId: id };
    }
    return s;
  });
}

/** Завантажити все для сторінки тайтлу (викликається при кожному переході). */
export async function loadTitle(page: TitlePage) {
  const cur = titleStore.get();
  if (cur && cur.page.kind === page.kind && cur.page.slug === page.slug) return;

  const token = ++loadToken;
  unwatch?.();
  unwatchSync?.();
  unwatchSync = null;
  readerStore.set(null);
  const { kind, slug } = page;
  // Стан з'являється одразу, щоб блоки на сторінці показалися навіть до завантаження.
  titleStore.set({
    page,
    sources: {},
    activeId: null,
    activeChosen: false,
    teams: {},
    progress: { last: null, chapters: {}, updatedAt: 0 },
  });

  let binding: Awaited<ReturnType<typeof getBinding>>;
  try {
    // Вибір джерела/команди з інших пристроїв (storage.sync), якщо новіший.
    binding = await getBindingSynced(kind, slug);
    // Спершу — прогрес з інших пристроїв (storage.sync), якщо він новіший.
    const unsync = await syncProgress(kind, slug).catch(() => () => {});
    if (token !== loadToken) return unsync();
    unwatchSync = unsync;
    const progress = await getProgress(kind, slug);
    patch(token, (s) => ({
      ...s,
      activeId: binding.active,
      activeChosen: !!binding.active,
      teams: binding.teams,
      progress,
    }));
  } catch (e) {
    console.error('[Hikka Plus] storage', e);
    patch(token, (s) => ({ ...s, hikkaError: `Помилка сховища розширення: ${String(e)}` }));
    return;
  }
  unwatch = watchProgress(kind, slug, (progress) => {
    const prev = titleStore.get();
    if (token !== loadToken || !prev) return;
    // Нові прочитані розділи → лічильник у списку Hikka.
    const newly = maxReadNumber(progress, prev.progress);
    if (newly > 0) void queueHikkaChapters(kind, slug, newly, prev.hikka?.chapters ?? null);
    patch(token, (s) => ({ ...s, progress }));
  });
  void loadRemoteRead(kind, slug);

  let hikka: HikkaTitle;
  try {
    hikka = await fetchHikkaTitle(kind, slug);
  } catch (e) {
    console.error('[Hikka Plus] hikka api', e);
    patch(token, (s) => ({ ...s, hikkaError: `Не вдалося отримати дані тайтлу з Hikka: ${String(e)}` }));
    return;
  }
  patch(token, (s) => ({ ...s, hikka }));

  await Promise.all(
    sourcesFor(kind).map(async (source) => {
      const link = binding.links[source.id];
      if (link) {
        const remote: RemoteTitle = {
          id: link.remoteId,
          title: link.title,
          altTitles: [],
          format: kind === 'novel' ? 'novel' : 'manga',
          url: link.url ?? '',
        };
        pickActive(token);
        return loadChapters(token, source, remote, link.manual);
      }
      if (link === null && Date.now() - (binding.misses[source.id] ?? 0) < MISS_TTL) {
        setSource(token, source.id, { status: 'not-found', chapters: [] });
        pickActive(token);
        return;
      }
      setSource(token, source.id, { status: 'searching', chapters: [] });
      const remote = await source.autoMatch(hikka).catch(() => null);
      if (token !== loadToken) return;
      await patchBinding(kind, slug, (b) => ({
        ...b,
        links: {
          ...b.links,
          [source.id]: remote ? { remoteId: remote.id, title: remote.title, url: remote.url, manual: false } : null,
        },
        misses: { ...b.misses, [source.id]: remote ? 0 : Date.now() },
      }));
      if (!remote) {
        setSource(token, source.id, { status: 'not-found', chapters: [] });
        pickActive(token);
        return;
      }
      pickActive(token);
      await loadChapters(token, source, remote, false);
      pickActive(token);
    }),
  );
}

export function resetTitle() {
  resetRemoteRead();
  loadToken++;
  unwatch?.();
  unwatch = null;
  unwatchSync?.();
  unwatchSync = null;
  readerStore.set(null);
  titleStore.set(null);
}

// ---------- Дії користувача ----------

export async function setActiveSource(id: string) {
  const s = titleStore.get();
  if (!s) return;
  titleStore.set({ ...s, activeId: id, activeChosen: true });
  await patchBinding(s.page.kind, s.page.slug, (b) => ({ ...b, active: id }));
}

export async function setTeam(team: string) {
  const s = titleStore.get();
  if (!s?.activeId) return;
  const teams = { ...s.teams, [s.activeId]: team };
  titleStore.set({ ...s, teams });
  await patchBinding(s.page.kind, s.page.slug, (b) => ({ ...b, teams }));
}

/** Ручна прив'язка до знайденого тайтлу; джерело стає активним. */
export async function bindManually(source: ReadSource, remote: RemoteTitle) {
  const s = titleStore.get();
  if (!s) return;
  const { kind, slug } = s.page;
  await patchBinding(kind, slug, (b) => ({
    ...b,
    active: source.id,
    links: { ...b.links, [source.id]: { remoteId: remote.id, title: remote.title, url: remote.url, manual: true } },
  }));
  titleStore.set({ ...s, activeId: source.id, activeChosen: true });
  await loadChapters(loadToken, source, remote, true);
}

/** Відмітити розділ прочитаним / непрочитаним вручну. */
export function setChapterRead(c: Chapter, read: boolean) {
  const s = titleStore.get();
  if (!s) return;
  const key = chapterKey(c.number);
  return updateProgress(s.page.kind, s.page.slug, (p) => ({
    ...p,
    chapters: { ...p.chapters, [key]: { pos: read ? 1 : 0, read, at: Date.now() } },
  }));
}

/** Найбільший номер розділу, який став прочитаним у `next` порівняно з `prev` (0 — нічого). */
function maxReadNumber(next: Progress, prev: Progress): number {
  let max = 0;
  for (const [k, c] of Object.entries(next.chapters)) {
    if (!c.read || prev.chapters[k]?.read) continue;
    const n = Number.parseFloat(k);
    if (Number.isFinite(n)) max = Math.max(max, Math.floor(n));
  }
  return max;
}

/** Найбільший прочитаний номер розділу (для «Записати в Hikka»). */
export function maxReadLocal(p: Progress): number {
  return maxReadNumber(p, { last: null, chapters: {}, updatedAt: 0 });
}

/** Відмітити прочитаними всі розділи з номером ≤ n (з усіх знайдених джерел). */
export function markReadUpTo(n: number) {
  const s = titleStore.get();
  if (!s) return;
  const keys = new Set<string>();
  for (const st of Object.values(s.sources))
    for (const c of st.chapters) {
      const num = Number.parseFloat(c.number.replace(',', '.'));
      if (Number.isFinite(num) && num <= n) keys.add(chapterKey(c.number));
    }
  for (let i = 1; i <= n; i++) keys.add(String(i));
  const at = Date.now();
  return updateProgress(s.page.kind, s.page.slug, (p) => {
    const chapters = { ...p.chapters };
    for (const k of keys) if (!chapters[k]?.read) chapters[k] = { pos: 1, read: true, at };
    return { ...p, chapters };
  });
}
