/*
 * Плеєр аніме: спільні типи. Провайдери (Mikai, AnimeON) віддають команди з плеєрами,
 * блок «Перегляд» показує їх і вбудовує iframe самого плеєра (потоки не витягуємо).
 */

/** Плеєр-iframe. custom — плеєр, який користувач додав embed-кодом (пізніше). */
export type PlayerKind = 'ashdi' | 'moon' | 'fenix' | 'custom';

/** Сайт, звідки взяли команду й посилання на плеєр. */
export type WatchSite = 'mikai' | 'animeon';

export type WatchPlayer = {
  /** Унікальний у межах команди: `${site}:${kind}`. */
  id: string;
  kind: PlayerKind;
  site: WatchSite;
  label: string;
  noAds?: boolean;
  /** Номери серій, що є в цього плеєра. */
  episodes: number[];
  /** Адреса iframe для серії (у AnimeON — окремим запитом). null — серії немає. */
  src: (n: number) => Promise<string | null>;
};

export type WatchTeam = {
  /** Ключ для злиття однакових команд із різних сайтів: нормалізована назва + :sub. */
  id: string;
  name: string;
  avatar?: string;
  sub: boolean;
  players: WatchPlayer[];
  /** Глибоке посилання на Dawn у Mikai (вбудовування в Dawn немає). */
  dawn?: (ep: number) => string;
};

/** Стан серії: pos — частка переглянутого (0..1), watched — зараховано (дійшли до ендингу). */
export type EpisodeState = { pos: number; watched: boolean };

export const PLAYER_NAMES: Record<PlayerKind, string> = {
  ashdi: 'Ashdi',
  moon: 'Moon',
  fenix: 'Fenix',
  custom: 'Свій плеєр',
};

export const SITE_NAMES: Record<WatchSite, string> = { mikai: 'Mikai', animeon: 'AnimeON' };

/** Скільки серій у команди — за плеєром, у якого їх найбільше. */
export const teamEpisodes = (t: WatchTeam) => Math.max(0, ...t.players.map((p) => p.episodes.length));

/** Хости iframe, які вбудовуємо (лише https). Решту — не показуємо. */
export const FRAME_HOSTS: Record<string, Exclude<PlayerKind, 'custom'>> = {
  'ashdi.vip': 'ashdi',
  'moonanime.art': 'moon',
  'moonanime.net': 'moon',
  'fenixplay.xyz': 'fenix',
};

/** Перевірити адресу плеєра: https і відомий хост; для Moon — увімкнути postMessage-API (?api=1). */
export function safeFrameSrc(raw: string | null | undefined, kind: PlayerKind): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || FRAME_HOSTS[u.host] !== kind) return null;
    if (kind === 'moon') u.searchParams.set('api', '1');
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Підсвітка навколо плеєра (entrypoints/player-frame.content.ts ↔ PlayerFrame):
 * AMBIENT_MSG — з фрейму: {ready} | {w, h, px: ArrayBuffer RGBA} | {off} (кадр недоступний);
 * AMBIENT_REQ — з hikka.io у фрейм: {on: boolean}.
 */
export const AMBIENT_MSG = 'hikka-plus:ambient';
export const AMBIENT_REQ = 'hikka-plus:ambient-req';
