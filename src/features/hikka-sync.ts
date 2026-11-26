/**
 * Синхронізація прогресу з лічильником розділів у списку Hikka (PUT /read/{type}/{slug}).
 * Дочитав розділ N → у Hikka стає max(розділів, N); на останньому розділі — «Прочитано».
 */
import { storage } from '#imports';
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  hikkaConsent,
  authErrorItem,
  exchangeReference,
  getRead,
  hikkaConfigured,
  oauthUrl,
  putRead,
  returnItem,
  tokenItem,
  watchLoginItem,
  watchScopeItem,
  type HikkaRead,
} from '../core/hikka-auth';
import { notifyHikkaReadChanged } from '../core/bridge';
import type { ReadKind } from '../core/page';

export const autoSyncItem = storage.defineItem<boolean>('local:hp:hikkaAutoSync', { fallback: true });

/**
 * Відмітки, що не дійшли до Hikka (MK 22:30): «${kind}:${slug}» → скільки розділів треба дописати.
 * Пишемо ДО відправки (і одразу при постановці в чергу — вкладку можуть закрити за ці 2,5 с),
 * стираємо, коли Hikka вже має ≥ n. При наступному заході на тайтл — `retryHikkaChapters`.
 * Дотягуємо лише такі «зірвані» відправки, а не завжди: інакше «−» у віджеті Hikka повертався б угору.
 */
type Retry = Record<string, { n: number; total: number | null; at: number }>;
const retryItem = storage.defineItem<Retry>('local:hp:hikkaRetry', { fallback: {} });
const RETRY_MAX = 50;

async function markRetry(key: string, n: number, total: number | null) {
  const all = { ...(await retryItem.getValue()) };
  if ((all[key]?.n ?? 0) >= n) return;
  all[key] = { n, total, at: Date.now() };
  const keys = Object.keys(all).sort((a, b) => all[b]!.at - all[a]!.at);
  for (const k of keys.slice(RETRY_MAX)) delete all[k];
  await retryItem.setValue(all);
}

/** Hikka вже має ≥ n (або користувач сам знизив) — для `upTo` = undefined стерти будь-яке. */
async function clearRetry(key: string, upTo?: number) {
  const all = await retryItem.getValue();
  const r = all[key];
  if (!r || (upTo != null && r.n > upTo)) return;
  const next = { ...all };
  delete next[key];
  await retryItem.setValue(next);
}

/** Зайшли на тайтл: якщо минулого разу відмітка не дійшла — дослати її (лише вгору, як завжди). */
export async function retryHikkaChapters(kind: ReadKind, slug: string) {
  const r = (await retryItem.getValue())[`${kind}:${slug}`];
  if (!r || !(await autoSyncItem.getValue()) || !(await tokenItem.getValue())) return;
  await setHikkaChapters(kind, slug, r.n, r.total);
}

// ---------- Вхід ----------

interface HikkaAuthState {
  configured: boolean;
  connected: boolean;
  autoSync: boolean;
  error: string | null;
}

export function useHikkaAuth(): HikkaAuthState {
  const [st, setSt] = useState<HikkaAuthState>({
    configured: hikkaConfigured(),
    connected: false,
    autoSync: true,
    error: null,
  });
  useEffect(() => {
    const load = async () => {
      const [t, a, e] = await Promise.all([tokenItem.getValue(), autoSyncItem.getValue(), authErrorItem.getValue()]);
      setSt((s) => ({ ...s, connected: !!t, autoSync: a, error: e }));
    };
    void load();
    const uns = [tokenItem.watch(load), autoSyncItem.watch(load), authErrorItem.watch(load)];
    return () => uns.forEach((u) => u());
  }, []);
  return st;
}

/** Перейти на сторінку підтвердження Hikka; після неї повернемося сюди ж. */
export async function startHikkaLogin(watch = false) {
  await returnItem.setValue(location.pathname + location.search);
  await authErrorItem.setValue(null);
  await watchLoginItem.setValue(watch);
  // Firefox: спершу згода на передачу даних у Hikka. З content script її не попросити — фон відкриє вкладку
  // налаштувань «Hikka», там «Увійти» спитає згоду й поверне сюди ж (returnItem/watchLoginItem уже записані).
  const c = await hikkaConsent(true);
  if (!c.ok || !c.data) return;
  location.assign(oauthUrl(watch));
}

/** Сторінка-повернення з Hikka (/hikka-plus-auth?reference=…): міняємо reference на токен. */
export async function finishHikkaLogin() {
  const reference = new URLSearchParams(location.search).get('reference') ?? '';
  const res = await exchangeReference(reference);
  await authErrorItem.setValue(res.ok ? null : `Не вдалося увійти в Hikka: ${res.message ?? res.error}`);
  if (res.ok) await watchScopeItem.setValue(await watchLoginItem.getValue());
  await watchLoginItem.setValue(false);
  const back = (await returnItem.getValue()) || '/';
  await returnItem.setValue(null);
  // Лише шлях на hikka.io, щоб не перекинути кудись назовні.
  location.replace(back.startsWith('/') && !back.startsWith('//') ? back : '/');
}

// ---------- Стан у списку Hikka для поточного тайтлу ----------

interface RemoteReadState {
  kind: ReadKind;
  slug: string;
  status: 'loading' | 'none' | 'ok' | 'error';
  read?: HikkaRead;
  error?: string;
}

let remote: RemoteReadState | null = null;
const listeners = new Set<() => void>();
const setRemote = (v: RemoteReadState | null) => {
  remote = v;
  listeners.forEach((l) => l());
};
export const useRemoteRead = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => remote,
  );

const isCur = (kind: ReadKind, slug: string) => remote?.kind === kind && remote.slug === slug;

export async function loadRemoteRead(kind: ReadKind, slug: string, quiet = false) {
  if (!(await tokenItem.getValue())) return setRemote(null);
  // quiet — оновлення вже показаного числа: без «Завантаження…» у рядку Hikka.
  if (!quiet || !isCur(kind, slug)) setRemote({ kind, slug, status: 'loading' });
  const r = await getRead(kind, slug);
  if (!isCur(kind, slug)) return;
  if (r.ok) setRemote({ kind, slug, status: 'ok', read: r.data as HikkaRead });
  else if (r.error === 'not-found') setRemote({ kind, slug, status: 'none' });
  else setRemote({ kind, slug, status: 'error', error: r.message ?? r.error });
}

export const resetRemoteRead = () => setRemote(null);

// ---------- Запис у Hikka ----------

const EMPTY: HikkaRead = {
  status: 'reading',
  chapters: 0,
  volumes: 0,
  rereads: 0,
  score: 0,
  note: null,
  start_date: null,
  end_date: null,
};

/**
 * Записати в Hikka, що прочитано щонайменше `n` розділів.
 * PUT перезаписує весь запис, тож спершу читаємо його й зберігаємо решту полів.
 */
export async function setHikkaChapters(kind: ReadKind, slug: string, n: number, total: number | null) {
  n = Math.min(Math.floor(n), 10000);
  if (!(n > 0) || !(await tokenItem.getValue())) return;
  const key = `${kind}:${slug}`;
  await markRetry(key, n, total);
  const cur = await getRead(kind, slug);
  if (!cur.ok && cur.error !== 'not-found') {
    if (cur.error === 'auth') await authErrorItem.setValue('Вхід у Hikka закінчився — увійди ще раз.');
    else console.warn('[Hikka Plus] Hikka: не вдалося прочитати запис, дошлю пізніше', cur.error, cur.message);
    return;
  }
  const base = cur.ok ? (cur.data as HikkaRead) : EMPTY;
  const finished = !!total && n >= total;
  if (base.chapters >= n && (!finished || base.status === 'completed')) return clearRetry(key, n);

  const now = Math.floor(Date.now() / 1000);
  const next: HikkaRead = {
    ...base,
    chapters: Math.max(base.chapters, n),
    status: finished ? 'completed' : base.status === 'completed' ? 'completed' : 'reading',
    start_date: base.start_date ?? now,
    end_date: finished ? (base.end_date ?? now) : base.end_date,
  };
  const res = await putRead(kind, slug, next);
  if (res.ok) {
    await clearRetry(key, n);
    if (isCur(kind, slug)) setRemote({ kind, slug, status: 'ok', read: res.data as HikkaRead });
    // Віджет «у списку» на сторінці Hikka — оновити одразу, без F5.
    notifyHikkaReadChanged(slug);
  } else {
    console.warn('[Hikka Plus] Hikka: запис не вдався, дошлю пізніше', res.error, res.message);
    await authErrorItem.setValue(
      res.error === 'auth' ? 'Вхід у Hikka закінчився — увійди ще раз.' : `Не вдалося оновити Hikka: ${res.message}`,
    );
  }
}

/**
 * Зменшити лічильник у Hikka до `n` (ручне зняття «прочитано»). Лише вниз і лише якщо тайтл уже
 * у списку; «Прочитано» стає «Читаю». Скидання прогресу в налаштуваннях Hikka НЕ чіпає.
 */
export async function lowerHikkaChapters(kind: ReadKind, slug: string, n: number) {
  n = Math.max(0, Math.floor(n));
  if (!(await autoSyncItem.getValue()) || !(await tokenItem.getValue())) return;
  // Відмітка «прочитано» ще чекала в черзі — вона застаріла.
  const key = `${kind}:${slug}`;
  const prev = pending.get(key);
  if (prev) {
    clearTimeout(prev.timer);
    pending.delete(key);
  }
  // Користувач сам знизив — недіслана відмітка вгору застаріла.
  await clearRetry(key);
  const cur = await getRead(kind, slug);
  if (!cur.ok) {
    if (cur.error === 'auth') await authErrorItem.setValue('Вхід у Hikka закінчився — увійди ще раз.');
    return;
  }
  const base = cur.data as HikkaRead;
  if (base.chapters <= n) return;
  const wasDone = base.status === 'completed';
  const next: HikkaRead = {
    ...base,
    chapters: n,
    status: wasDone ? 'reading' : base.status,
    end_date: wasDone ? null : base.end_date,
  };
  const res = await putRead(kind, slug, next);
  if (res.ok) {
    if (isCur(kind, slug)) setRemote({ kind, slug, status: 'ok', read: res.data as HikkaRead });
    notifyHikkaReadChanged(slug);
  } else {
    await authErrorItem.setValue(
      res.error === 'auth' ? 'Вхід у Hikka закінчився — увійди ще раз.' : `Не вдалося оновити Hikka: ${res.message}`,
    );
  }
}

// Дочитування кількох розділів поспіль зводимо в один запит.
const pending = new Map<string, { n: number; total: number | null; timer: ReturnType<typeof setTimeout> }>();

export async function queueHikkaChapters(kind: ReadKind, slug: string, n: number, total: number | null) {
  if (!(await autoSyncItem.getValue()) || !(await tokenItem.getValue())) return;
  const key = `${kind}:${slug}`;
  const prev = pending.get(key);
  if (prev) clearTimeout(prev.timer);
  const max = Math.max(prev?.n ?? 0, n);
  await markRetry(key, max, total);
  const timer = setTimeout(() => {
    pending.delete(key);
    void setHikkaChapters(kind, slug, max, total);
  }, 2500);
  pending.set(key, { n: max, total, timer });
}
