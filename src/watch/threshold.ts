/*
 * Коли серію зараховувати (рішення MK 2026-11-23): з початку ендингу.
 *  початок ED — з міток (src/watch/skip-marks.ts: плеєр → AniSkip з перевіркою);
 *  інакше — приблизно до ендингу: за 10 % тривалості до кінця, не більше 2:30
 *  (MK 2026-11-26: «за 90 с» — пізно, ендинг з анонсом часто довший; 24 хв → 2:24, 12 хв → 1:12).
 * AniSkip отримує MAL-id і номер серії (вказати в політиці приватності).
 */
import { getJson } from '../core/net';

export const FALLBACK_MAX_SEC = 150;
export const FALLBACK_SHARE = 0.1;

/** Скільки секунд до кінця зараховувати серію без міток ED. */
export function fallbackSec(duration: number): number {
  return Math.min(FALLBACK_MAX_SEC, duration * FALLBACK_SHARE);
}

export type AniSkip = {
  found: boolean;
  results?: { skipType: string; interval: { startTime: number; endTime: number }; episodeLength: number }[];
};

const cache = new Map<string, Promise<AniSkip | null>>();

/** Сирі мітки AniSkip для серії (кеш на сесію). */
export function aniskipRaw(malId: number, ep: number): Promise<AniSkip | null> {
  const key = `${malId}:${ep}`;
  let p = cache.get(key);
  if (!p) {
    const url = `https://api.aniskip.com/v2/skip-times/${malId}/${ep}?types[]=op&types[]=ed&types[]=mixed-op&types[]=mixed-ed&episodeLength=0`;
    p = getJson<AniSkip>(url).catch(() => null);
    cache.set(key, p);
  }
  return p;
}

/** Секунда, з якої серія вважається переглянутою. */
export function watchedAt(duration: number, playerEd: number | null, aniskipEd: number | null): number {
  const fallback = Math.max(duration * 0.5, duration - fallbackSec(duration));
  // Мітка плеєра має бути в розумних межах (друга половина серії).
  if (playerEd && playerEd > duration * 0.5 && playerEd < duration) return playerEd;
  if (aniskipEd && aniskipEd > duration * 0.5 && aniskipEd < duration) return aniskipEd;
  return fallback;
}
