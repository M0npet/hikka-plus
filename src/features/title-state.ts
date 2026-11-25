import { noteCover } from '../cards/covers';
import { useSyncExternalStore } from 'react';
import { fetchHikkaTitle, type HikkaTitle } from '../core/hikka';
import type { TitlePage } from '../core/page';
import { isRateLimit, RATE_LIMIT_TEXT } from '../core/net';
import {
  chapterKey,
  getBinding,
  getBindingSynced,
  getProgress,
  patchBinding,
  type SourceLink,
  syncProgress,
  updateProgress,
  watchProgress,
  type Progress,
} from '../core/store';
import { getSource, sourcesFor } from '../sources/registry';
import { takeNearMiss } from '../sources/match';
import { renumberByVolume, type Chapter, type ContentFormat, type ReadSource, type RemoteTitle } from '../sources/types';
import { loadRemoteRead, lowerHikkaChapters, queueHikkaChapters, resetRemoteRead, retryHikkaChapters } from './hikka-sync';
import { HIKKA_LIST_EVENT } from '../core/bridge';
import { noteReleased } from '../cards/released';

// Hikka сама змінила запис у своєму списку (напр. «+/−» у віджеті зліва; сигнал — від hikka-bridge):
// тихо перечитуємо число з Hikka — далі hikka-bar відмітить 1–N, як при заході на сторінку.
let listTimer: ReturnType<typeof setTimeout> | undefined;
if (typeof document !== 'undefined')
  document.addEventListener(HIKKA_LIST_EVENT, (e) => {
    if ((e as CustomEvent<unknown>).detail !== 'read') return;
    clearTimeout(listTimer);
    listTimer = setTimeout(() => {
      const page = titleStore.get()?.page;
      if (page) void loadRemoteRead(page.kind, page.slug, true);
    }, 800);
  });

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
  /** Не знайдено, але є схожий тайтл — підказка «Схоже» (прив'язка лише по кліку). */
  near?: RemoteTitle;
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

// Плашка «▶ N нових розділів» на картках (src/cards/released.ts): запам'ятати, скільки розділів у активного джерела й команди.
let releasedDigest = '';
titleStore.subscribe(() => {
  const s = titleStore.get();
  const st = s ? activeState(s) : undefined;
  if (!s || !s.activeId || st?.status !== 'ready' || !st.remote) return;
  const team = activeTeam(s);
  const digest = `${s.page.kind}:${s.page.slug}|${s.activeId}|${st.remote.id}|${team}|${st.chapters.length}`;
  if (digest === releasedDigest) return;
  releasedDigest = digest;
  void noteReleased(s.page.kind, s.page.slug, s.activeId, st.remote.id, team, st.chapters);
});
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

/**
 * Скільки розділів у кожної команди перекладу (унікальні номери — частини розділу не рахуються
 * двічі). Порядок — як команди трапляються у списку.
 */
export function teamCounts(list: Chapter[]): Map<string, number> {
  const sets = new Map<string, Set<string>>();
  for (const c of list) {
    if (!c.team) continue;
    let set = sets.get(c.team);
    if (!set) sets.set(c.team, (set = new Set()));
    set.add(chapterKey(c.number));
  }
  return new Map([...sets].map(([t, set]) => [t, set.size]));
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
/** Версія автопідбору: збільшити, коли він став знаходити більше, — старі «не знайдено» перевіряться знову. */
const MATCH_VERSION = 3;

let loadToken = 0;
let unwatch: (() => void) | null = null;
let unwatchSync: (() => void) | null = null;

function patch(token: number, fn: (s: TitleState) => TitleState) {
  const cur = titleStore.get();
  if (token !== loadToken || !cur) return;
  titleStore.set(fn(cur));
}

const linkToRemote = (l: SourceLink, kind: TitlePage['kind']): RemoteTitle => ({
  id: l.remoteId,
  title: l.title,
  altTitles: [],
  format: kind === 'novel' ? 'novel' : 'manga',
  url: l.url ?? '',
});

const setSource = (token: number, id: string, p: Partial<SourceState>) =>
  patch(token, (s) => ({
    ...s,
    sources: { ...s.sources, [id]: { ...(s.sources[id] ?? { status: 'searching', chapters: [] }), ...p } },
  }));

async function loadChapters(token: number, source: ReadSource, remote: RemoteTitle, manual: boolean) {
  setSource(token, source.id, { status: 'loading', remote, manual, chapters: [], error: undefined, near: undefined });
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
      // 429 під час автопідбору (нічого не прив'язано) — не робимо його активним, беремо наступне знайдене.
      if (st.status === 'error' && !st.remote) continue;
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

  const on = (id: string | null): id is string => !!id && sourcesFor(kind).some((x) => x.id === id);
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
      // Обране раніше джерело могли вимкнути у налаштуваннях — тоді обираємо автоматично.
      activeId: on(binding.active) ? binding.active : null,
      activeChosen: on(binding.active),
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
  // Минулого разу відмітка не дійшла до Hikka (мережа, закрита вкладка) — дослати.
  void retryHikkaChapters(kind, slug);

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
        pickActive(token);
        return loadChapters(token, source, linkToRemote(link, kind), link.manual);
      }
      // «Не знайдено» записане старішим автопідбором (до «Схоже» / запасних запитів) — шукаємо знову.
      if (link === null && binding.nearV === MATCH_VERSION && Date.now() - (binding.misses[source.id] ?? 0) < MISS_TTL) {
        const near = binding.near?.[source.id];
        setSource(token, source.id, { status: 'not-found', chapters: [], near: near ? linkToRemote(near, kind) : undefined });
        pickActive(token);
        return;
      }
      setSource(token, source.id, { status: 'searching', chapters: [] });
      let limited = false;
      let remote = await source.autoMatch(hikka).catch((e) => {
        limited = isRateLimit(e);
        return null;
      });
      // Сайт попросив почекати (429) — це не «не знайдено»: нічого не записуємо, наступного заходу шукаємо знову.
      if (limited) {
        setSource(token, source.id, { status: 'error', error: RATE_LIMIT_TEXT });
        pickActive(token);
        return;
      }
      // Користувач відв'язав цей тайтл («Відв'язати», unbindSource) — автопідбір його більше не прив'язує.
      if (remote && remote.id === binding.nearNo?.[source.id]) remote = null;
      let near = remote ? null : takeNearMiss(source, hikka);
      if (near && near.id === binding.nearNo?.[source.id]) near = null;
      if (token !== loadToken) return;
      await patchBinding(kind, slug, (b) => ({
        ...b,
        links: {
          ...b.links,
          [source.id]: remote ? { remoteId: remote.id, title: remote.title, url: remote.url, manual: false } : null,
        },
        misses: { ...b.misses, [source.id]: remote ? 0 : Date.now() },
        near: withNear(b.near, source.id, near),
        nearV: MATCH_VERSION,
      }));
      if (!remote) {
        setSource(token, source.id, { status: 'not-found', chapters: [], near: near ?? undefined });
        pickActive(token);
        return;
      }
      pickActive(token);
      await loadChapters(token, source, remote, false);
      pickActive(token);
    }),
  );
  // Прив'язки відомі — український постер з джерела (src/cards/covers.ts).
  if (token === loadToken) void noteCover(kind, slug).catch(() => {});
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

function withNear(cur: Record<string, SourceLink> | undefined, id: string, t: RemoteTitle | null) {
  const next = { ...cur };
  if (t) next[id] = { remoteId: t.id, title: t.title, url: t.url, manual: false };
  else delete next[id];
  return next;
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
    near: withNear(b.near, source.id, null),
  }));
  titleStore.set({ ...s, activeId: source.id, activeChosen: true });
  void noteCover(kind, slug).catch(() => {});
  await loadChapters(loadToken, source, remote, true);
}

/**
 * «Відв'язати» (MK 2026-11-25: «не тот тайтл привязал»): прибрати прив'язку активного джерела — ручну чи автопідбір.
 * Цей тайтл на джерелі більше не пропонуємо й не прив'язуємо автоматично (nearNo); активним стає наступне знайдене
 * джерело; постер і «нових розділів» беруться вже з нього (noteCover / noteReleased).
 */
export async function unbindSource(sourceId: string) {
  const s = titleStore.get();
  const st = s?.sources[sourceId];
  if (!s || !st) return;
  const { kind, slug } = s.page;
  const remoteId = st.remote?.id;
  titleStore.set({
    ...s,
    sources: { ...s.sources, [sourceId]: { status: 'not-found', chapters: [] } },
    ...(s.activeId === sourceId ? { activeId: null, activeChosen: false } : {}),
  });
  pickActive(loadToken);
  await patchBinding(kind, slug, (b) => ({
    ...b,
    active: b.active === sourceId ? null : b.active,
    links: { ...b.links, [sourceId]: null },
    misses: { ...b.misses, [sourceId]: Date.now() },
    near: withNear(b.near, sourceId, null),
    nearNo: remoteId ? { ...b.nearNo, [sourceId]: remoteId } : b.nearNo,
    nearV: MATCH_VERSION,
  }));
  void noteCover(kind, slug).catch(() => {});
}

/** Підказка «Схоже» → «Ні»: прибрати й більше не пропонувати цей тайтл для цього джерела. */
export async function rejectNear(sourceId: string) {
  const s = titleStore.get();
  const st = s?.sources[sourceId];
  const near = st?.near;
  if (!s || !st || !near) return;
  titleStore.set({ ...s, sources: { ...s.sources, [sourceId]: { ...st, near: undefined } } });
  await patchBinding(s.page.kind, s.page.slug, (b) => ({
    ...b,
    near: withNear(b.near, sourceId, null),
    nearNo: { ...b.nearNo, [sourceId]: near.id },
  }));
}

/** Відмітити розділ прочитаним / непрочитаним вручну. */
export async function setChapterRead(c: Chapter, read: boolean) {
  const s = titleStore.get();
  if (!s) return;
  const { kind, slug } = s.page;
  const key = chapterKey(c.number);
  let next: Progress | null = null;
  await updateProgress(kind, slug, (p) => {
    next = { ...p, chapters: { ...p.chapters, [key]: { pos: read ? 1 : 0, read, at: Date.now() } } };
    return next;
  });
  // Зняв галочку → у Hikka номер останнього розділу, прочитаного поспіль від початку.
  if (!read && next) {
    const n = readRunBefore(next, Number.parseFloat(key));
    if (n !== null) void lowerHikkaChapters(kind, slug, n);
  }
}

/**
 * Скільки розділів прочитано поспіль до непрочитаного `num` (ціле; додаткові «5.5» лічильник Hikka
 * не рахує — null). Ідемо вниз, поки розділ тут явно непрочитаний; розділ без запису вважаємо
 * прочитаним (його могли прочитати деінде) — інакше одна зняла галочка обнулила б Hikka.
 */
function readRunBefore(p: Progress, num: number): number | null {
  if (!Number.isInteger(num) || num < 1) return null;
  let n = num - 1;
  while (n > 0 && p.chapters[String(n)]?.read === false) n--;
  return n;
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

/**
 * Розділи з номером ≤ n, яких користувач тут ще не торкався (немає запису прогресу) —
 * напр. проміжні «34.5» з джерела, що завантажилось після першої автовідмітки.
 * Зняті вручну (запис read:false) не чіпаємо.
 */
export function untrackedUpTo(s: TitleState, n: number): string[] {
  const keys = new Set<string>();
  for (const st of Object.values(s.sources))
    for (const c of st.chapters) {
      const num = Number.parseFloat(c.number.replace(',', '.'));
      const k = chapterKey(c.number);
      if (Number.isFinite(num) && num <= n && !s.progress.chapters[k]) keys.add(k);
    }
  return [...keys];
}

/** Відмітити прочитаними лише розділи без запису (див. `untrackedUpTo`). */
export function markUntrackedUpTo(n: number) {
  const s = titleStore.get();
  if (!s) return;
  const keys = untrackedUpTo(s, n);
  if (!keys.length) return;
  const at = Date.now();
  return updateProgress(s.page.kind, s.page.slug, (p) => {
    const chapters = { ...p.chapters };
    for (const k of keys) if (!chapters[k]) chapters[k] = { pos: 1, read: true, at };
    return { ...p, chapters };
  });
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
