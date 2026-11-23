/*
 * Коли серію зараховувати (рішення MK 2026-11-23): з початку ендингу.
 *  1) мітки самого плеєра (Moon get_skip_segments, Fenix skip_change) — головне;
 *  2) AniSkip — лише з перевіркою (краудсорс, розмітка під чужий реліз): його episodeLength ≈ тривалості в плеєрі (±30 с)
 *     і ED у останніх 20 % серії; рахуємо від кінця: duration − (episodeLength − ed.start), бо фандаб буває довшим/коротшим;
 *  3) інакше — за 90 с до кінця.
 * AniSkip отримує MAL-id і номер серії (вказати в політиці приватності).
 */
import { getJson } from '../core/net';

export const FALLBACK_SEC = 90;

type AniSkip = {
  found: boolean;
  results?: { skipType: string; interval: { startTime: number; endTime: number }; episodeLength: number }[];
};

const cache = new Map<string, Promise<AniSkip | null>>();

/** Сирі мітки AniSkip для серії (кеш на сесію). */
export function aniskipRaw(malId: number, ep: number): Promise<AniSkip | null> {
  const key = `${malId}:${ep}`;
  let p = cache.get(key);
  if (!p) {
    const url = `https://api.aniskip.com/v2/skip-times/${malId}/${ep}?types[]=ed&types[]=mixed-ed&episodeLength=0`;
    p = getJson<AniSkip>(url).catch(() => null);
    cache.set(key, p);
  }
  return p;
}

/** Початок ED за AniSkip, перерахований під тривалість у плеєрі; null — не віримо. */
export function edFromAniskip(a: AniSkip | null, duration: number): number | null {
  if (!a?.found || !(duration > 0)) return null;
  for (const r of a.results ?? []) {
    if (r.skipType !== 'ed' && r.skipType !== 'mixed-ed') continue;
    const len = r.episodeLength;
    const start = r.interval?.startTime;
    if (!(len > 0) || !(start > 0)) continue;
    if (Math.abs(len - duration) > 30) continue;
    if (len - start > len * 0.2) continue;
    return Math.max(0, duration - (len - start));
  }
  return null;
}

/** Секунда, з якої серія вважається переглянутою. */
export function watchedAt(duration: number, playerEd: number | null, aniskipEd: number | null): number {
  const fallback = Math.max(duration * 0.5, duration - FALLBACK_SEC);
  // Мітка плеєра має бути в розумних межах (друга половина серії).
  if (playerEd && playerEd > duration * 0.5 && playerEd < duration) return playerEd;
  if (aniskipEd && aniskipEd > duration * 0.5 && aniskipEd < duration) return aniskipEd;
  return fallback;
}
