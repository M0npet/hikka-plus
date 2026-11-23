/*
 * Лічильник серій у списку Hikka (PUT /watch/{slug}). Лише вгору: переглянув серію N → episodes = max(episodes, N);
 * остання серія → «Переглянуто». Потрібні дозволи read/update:watchlist — окремий вхід (кнопка в блоці).
 */
import { getWatch, putWatch, tokenItem, watchScopeItem, type HikkaWatch } from '../core/hikka-auth';
import { notifyHikkaWatchChanged } from '../core/bridge';

export type HikkaWatchState =
  | { status: 'off' } // не підключено Hikka
  | { status: 'scope' } // немає дозволу на список перегляду
  | { status: 'loading' }
  | { status: 'ok'; episodes: number; listed: boolean }
  | { status: 'error'; message: string };

const EMPTY: HikkaWatch = { status: 'watching', episodes: 0, rewatches: 0, score: 0, note: null, start_date: null, end_date: null };

export async function loadHikkaWatch(slug: string): Promise<HikkaWatchState> {
  if (!(await tokenItem.getValue())) return { status: 'off' };
  if (!(await watchScopeItem.getValue())) return { status: 'scope' };
  const r = await getWatch(slug);
  if (r.ok) return { status: 'ok', episodes: (r.data as HikkaWatch).episodes, listed: true };
  if (r.error === 'not-found') return { status: 'ok', episodes: 0, listed: false };
  if (r.error === 'scope') {
    await watchScopeItem.setValue(false);
    return { status: 'scope' };
  }
  if (r.error === 'auth') return { status: 'off' };
  return { status: 'error', message: r.message ?? r.error ?? 'помилка' };
}

/** Записати, що переглянуто щонайменше n серій. total — серій у тайтлі (Hikka не прийме більше). */
export async function markHikkaEpisodes(slug: string, n: number, total: number | null): Promise<HikkaWatchState> {
  if (total && n > total) n = total;
  const cur = await getWatch(slug);
  if (!cur.ok && cur.error !== 'not-found') {
    if (cur.error === 'scope') await watchScopeItem.setValue(false);
    return cur.error === 'scope' ? { status: 'scope' } : cur.error === 'auth' ? { status: 'off' } : { status: 'error', message: cur.message ?? '' };
  }
  const base = cur.ok ? (cur.data as HikkaWatch) : EMPTY;
  const done = !!total && n >= total;
  if (base.episodes >= n && (!done || base.status === 'completed')) return { status: 'ok', episodes: base.episodes, listed: cur.ok };
  const now = Math.floor(Date.now() / 1000);
  const next: HikkaWatch = {
    ...base,
    episodes: Math.max(base.episodes, n),
    status: done || base.status === 'completed' ? 'completed' : 'watching',
    start_date: base.start_date ?? now,
    end_date: done ? (base.end_date ?? now) : base.end_date,
  };
  const r = await putWatch(slug, next);
  if (!r.ok) return r.error === 'scope' ? { status: 'scope' } : { status: 'error', message: r.message ?? r.error ?? '' };
  notifyHikkaWatchChanged(slug);
  return { status: 'ok', episodes: (r.data as HikkaWatch).episodes, listed: true };
}

/**
 * Зняти відмітку: лічильник у Hikka опускаємо до n (як «прочитано» в читалці, 0.4.4). «Переглянуто» → «Дивлюсь».
 * Лише якщо в Hikka зараз більше за n.
 */
export async function lowerHikkaEpisodes(slug: string, n: number): Promise<HikkaWatchState> {
  n = Math.max(0, Math.floor(n));
  const cur = await getWatch(slug);
  if (!cur.ok) {
    if (cur.error === 'not-found') return { status: 'ok', episodes: 0, listed: false };
    if (cur.error === 'scope') await watchScopeItem.setValue(false);
    return cur.error === 'scope' ? { status: 'scope' } : cur.error === 'auth' ? { status: 'off' } : { status: 'error', message: cur.message ?? '' };
  }
  const base = cur.data as HikkaWatch;
  if (base.episodes <= n) return { status: 'ok', episodes: base.episodes, listed: true };
  const wasDone = base.status === 'completed';
  const next: HikkaWatch = {
    ...base,
    episodes: n,
    status: wasDone ? 'watching' : base.status,
    end_date: wasDone ? null : base.end_date,
  };
  const r = await putWatch(slug, next);
  if (!r.ok) return r.error === 'scope' ? { status: 'scope' } : { status: 'error', message: r.message ?? r.error ?? '' };
  notifyHikkaWatchChanged(slug);
  return { status: 'ok', episodes: (r.data as HikkaWatch).episodes, listed: true };
}
