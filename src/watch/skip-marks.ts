/*
 * Мітки опенінгу й ендингу (MK 2026-11-23, 18:07: «щоб усе відмічалося само, і було видно, де мітки насправді»).
 *
 * Звідки мітки (за пріоритетом):
 *  1) player  — мітки самого плеєра (Moon get_skip_segments, Fenix skip_change);
 *  2) auto    — знайшли самі: скрипт у фреймі плеєра (entrypoints/player-frame.content.ts) раз на 0,5 с секунди відео
 *               рахує відбиток кадру (32 біти: сітка 8×4 яскравостей, біт = вище медіани). Серії одного тайтлу мають
 *               однакові OP/ED — шукаємо в двох серіях однаковий шматок ≥ 30 с (на початку — OP, у кінці — ED),
 *               запам'ятовуємо його кадри як зразок і далі впізнаємо зразок у нових серіях уже за перші ~4 с;
 *  3) aniskip — краудсорс під чужий реліз: лише з перевіркою тривалості (±30 с), ED рахуємо від кінця.
 * Відбитки — лише локально (local:hp:fp:<slug>), нікуди не йдуть.
 */
import { storage } from '#imports';

export type Seg = { s: number; e: number };
export type MarkSrc = 'player' | 'auto' | 'aniskip';
export type Marks = { op?: Seg & { src: MarkSrc }; ed?: Seg & { src: MarkSrc } };

import { FLAT, FP_RATE } from './fp-hash';
export { FLAT, FP_RATE };

const MIN_RUN = 30 * FP_RATE; // спільний шматок ≥ 30 с
const MAX_RUN = 200 * FP_RATE; // OP/ED довше 3 хв 20 с не бувають
const MAX_DIST = 4; // біт різниці з 32 — той самий кадр (інший рип, субтитри)
const MAX_MISS = 3; // поспіль незбіжних кроків усередині шматка (вставки, мерехтіння)
const MAX_UNKNOWN = 8; // поспіль невідомих (темних) кроків — 4 с; довша темрява рве шматок, інакше OP «зростеться» з ED
const LIVE_WIN = 8; // кроків (4 с), щоб упізнати зразок у новій серії
const LIVE_HIT = 7;

const pop = (x: number) => {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};
/** 1 — той самий кадр, 0 — інший, -1 — невідомо (FLAT). */
const same = (a: number, b: number) => (a === FLAT || b === FLAT ? -1 : pop((a ^ b) >>> 0) <= MAX_DIST ? 1 : 0);

export { frameHash } from './fp-hash';

/* ---------- Пошук спільного шматка двох серій ---------- */

export type Run = { a: number; b: number; len: number };

/** Найдовші спільні шматки (по діагоналях зсуву), довші за MIN_RUN. a/b/len — у кроках. */
export function commonRuns(A: ArrayLike<number>, B: ArrayLike<number>): Run[] {
  const runs: Run[] = [];
  for (let k = -(B.length - 1); k < A.length; k++) {
    // i — індекс в A, j = i − k — у B.
    let start = -1;
    let last = -1;
    let hits = 0;
    let miss = 0;
    let unknown = 0;
    const i0 = Math.max(0, k);
    const i1 = Math.min(A.length, B.length + k);
    const close = () => {
      if (start >= 0 && hits >= MIN_RUN * 0.6) {
        const len = last - start + 1;
        if (len >= MIN_RUN && len <= MAX_RUN) runs.push({ a: start, b: start - k, len });
      }
      start = -1;
      hits = 0;
      miss = 0;
    };
    for (let i = i0; i < i1; i++) {
      const s = same(A[i]!, B[i - k]!);
      if (s === 1) {
        if (start < 0) start = i;
        last = i;
        hits++;
        miss = 0;
        unknown = 0;
      } else if (s === 0 && start >= 0 && ++miss > MAX_MISS) close();
      else if (s === -1 && start >= 0 && ++unknown > MAX_UNKNOWN) close();
    }
    close();
  }
  return runs.sort((x, y) => y.len - x.len);
}

/**
 * OP — шматок, що в ОБОХ серіях починається в перших 40 %; ED — що в обох закінчується в останніх 30 %.
 * (Анонс наступної серії в кінці A збігається із серединою B — так його не сплутаємо з ED.)
 */
export function classify(runs: Run[], lenA: number, lenB: number): { op?: Run; ed?: Run } {
  const out: { op?: Run; ed?: Run } = {};
  for (const r of runs) {
    if (!out.op && r.a < lenA * 0.4 && r.b < lenB * 0.4 && r.a + r.len < lenA * 0.6) out.op = r;
    else if (!out.ed && r.a + r.len > lenA * 0.7 && r.b + r.len > lenB * 0.7) out.ed = r;
  }
  return out;
}

/* ---------- Впізнавання зразка в серії, яку дивимось ---------- */

/**
 * live — відбитки поточної серії за індексом кроку (дірки — undefined). Шукаємо, чи останні LIVE_WIN кроків до `at`
 * збігаються з якимось місцем зразка. Повертає початок зразка в цій серії (кроки) або null.
 */
export function liveFind(live: ArrayLike<number | undefined>, at: number, tpl: ArrayLike<number>): number | null {
  if (at < LIVE_WIN - 1) return null;
  let informative = 0;
  const distinct = new Set<number>();
  for (let t = at - LIVE_WIN + 1; t <= at; t++) {
    const v = live[t];
    if (v === undefined || v === FLAT) continue;
    informative++;
    distinct.add(v >>> 8); // нерухомий кадр (заставка) — не доказ: потрібна зміна картинки
  }
  if (informative < LIVE_HIT - 1 || distinct.size < 3) return null;
  for (let j = 0; j + LIVE_WIN <= tpl.length; j++) {
    let hit = 0;
    let bad = 0;
    for (let q = 0; q < LIVE_WIN; q++) {
      const v = live[at - LIVE_WIN + 1 + q];
      if (v === undefined) continue;
      const s = same(v, tpl[j + q]!);
      if (s === 1) hit++;
      else if (s === 0 && ++bad > LIVE_WIN - LIVE_HIT) break;
    }
    if (hit >= LIVE_HIT - 1 && bad <= LIVE_WIN - LIVE_HIT) return at - LIVE_WIN + 1 - j;
  }
  return null;
}

/* ---------- Сховище: відбитки серій і зразки тайтлу ---------- */

const hex = (a: ArrayLike<number | undefined>) => {
  let s = '';
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    s += v === undefined || v === FLAT ? '--------' : (v >>> 0).toString(16).padStart(8, '0');
  }
  return s;
};
const unhex = (s: string): number[] => {
  const out: number[] = [];
  for (let i = 0; i + 8 <= s.length; i += 8) {
    const c = s.slice(i, i + 8);
    out.push(c === '--------' ? FLAT : parseInt(c, 16) >>> 0);
  }
  return out;
};

type FpStore = {
  /** Відбитки серій (останні EPS_KEEP переглянутих): hex по 8 символів на крок. */
  eps: Record<string, { h: string; d: number; at: number }>;
  /** Зразки кадрів OP/ED тайтлу (однакові в усіх серіях). */
  tpl: { op?: string; ed?: string };
  /** Знайдені мітки серій (сек). */
  marks: Record<string, { op?: Seg; ed?: Seg }>;
  u: number;
};
const EPS_KEEP = 3;
const TITLES_KEEP = 30;
const fpKey = (slug: string) => `local:hp:fp:${slug}` as const;
const indexItem = storage.defineItem<Record<string, number>>('local:hp:fpIndex', { fallback: {} });

export async function loadFp(slug: string): Promise<FpStore> {
  return (await storage.getItem<FpStore>(fpKey(slug))) ?? { eps: {}, tpl: {}, marks: {}, u: 0 };
}

async function saveFp(slug: string, s: FpStore) {
  s.u = Date.now();
  await storage.setItem(fpKey(slug), s);
  // Старі тайтли прибираємо, щоб відбитки не росли без кінця.
  const idx = { ...(await indexItem.getValue()), [slug]: s.u };
  const old = Object.entries(idx).sort((a, b) => b[1] - a[1]).slice(TITLES_KEEP);
  for (const [k] of old) {
    delete idx[k];
    await storage.removeItem(fpKey(k));
  }
  await indexItem.setValue(idx);
}

export const templates = (s: FpStore) => ({ op: s.tpl.op ? unhex(s.tpl.op) : null, ed: s.tpl.ed ? unhex(s.tpl.ed) : null });

/**
 * Зберегти відбитки серії й пошукати OP/ED, порівнявши з іншими збереженими серіями.
 * Повертає оновлене сховище (мітки для всіх серій, де щось знайшли).
 */
export async function learnEpisode(slug: string, ep: number, live: ArrayLike<number | undefined>, d: number): Promise<FpStore> {
  const s = await loadFp(slug);
  const A = Array.from({ length: live.length }, (_, i) => live[i] ?? FLAT);
  const known = A.filter((v) => v !== FLAT).length;
  if (known < 120) return s; // < 1 хв відбитків — нема з чим працювати
  // Склеїти з тим, що вже було для цієї серії (дивилися частинами).
  const prev = s.eps[ep] ? unhex(s.eps[ep]!.h) : [];
  for (let i = 0; i < prev.length; i++) if (A[i] === undefined || A[i] === FLAT) A[i] = prev[i]!;
  s.eps[ep] = { h: hex(A), d, at: Date.now() };
  const keep = Object.entries(s.eps).sort((a, b) => b[1].at - a[1].at).slice(0, EPS_KEEP);
  s.eps = Object.fromEntries(keep);

  const secs = (r: Run, from: 'a' | 'b'): Seg => ({ s: r[from] / FP_RATE, e: (r[from] + r.len) / FP_RATE });
  for (const [k, o] of Object.entries(s.eps)) {
    if (k === String(ep)) continue;
    const B = unhex(o.h);
    const found = classify(commonRuns(A, B), A.length, B.length);
    for (const kind of ['op', 'ed'] as const) {
      const r = found[kind];
      if (!r) continue;
      (s.marks[ep] ??= {})[kind] = secs(r, 'a');
      (s.marks[k] ??= {})[kind] = secs(r, 'b');
      const cur = s.tpl[kind];
      if (!cur || cur.length / 8 < r.len) s.tpl[kind] = hex(A.slice(r.a, r.a + r.len));
    }
  }
  await saveFp(slug, s);
  return s;
}

/** Запам'ятати мітку, впізнану за зразком у поточній серії. */
export async function rememberMark(slug: string, ep: number, kind: 'op' | 'ed', seg: Seg) {
  const s = await loadFp(slug);
  (s.marks[ep] ??= {})[kind] = seg;
  await saveFp(slug, s);
}

/* ---------- Мітки плеєра й AniSkip ---------- */

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(+v) ? +v : NaN);

/** Мітки з даних плеєра. Moon (перевірено 2026-11-23): [{t:'opening'|'ending', s, e, n}]; інші формати — на всяк випадок. */
export function segsFromPlayer(data: unknown): { op?: Seg; ed?: Seg } {
  const list: unknown[] = Array.isArray(data) ? data : data && typeof data === 'object' ? Object.values(data as object).flat() : [];
  const out: { op?: Seg; ed?: Seg } = {};
  for (const x of list) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const type = String(o.t ?? o.type ?? o.kind ?? o.skipType ?? o.name ?? '').toLowerCase();
    const iv = o.interval as Record<string, unknown> | undefined;
    const s = num(o.s ?? o.start ?? o.from ?? o.startTime ?? o.begin ?? iv?.startTime);
    const e = num(o.e ?? o.end ?? o.to ?? o.endTime ?? o.finish ?? iv?.endTime);
    if (!(s >= 0)) continue;
    const seg = { s, e: e > s ? e : NaN };
    if (/(^|[^a-z])(op|opening|intro)([^a-z]|$)/.test(type) && !out.op) out.op = seg;
    else if (/(^|[^a-z])(ed|ending|outro|credits)([^a-z]|$)/.test(type) && !out.ed && s > 0) out.ed = seg;
  }
  return out;
}

type AniSkip = {
  found: boolean;
  results?: { skipType: string; interval: { startTime: number; endTime: number }; episodeLength: number }[];
};

/** AniSkip під тривалість у плеєрі (±30 с): OP — від початку, ED — від кінця (фандаб буває довшим/коротшим). */
export function segsFromAniskip(a: AniSkip | null, duration: number): { op?: Seg; ed?: Seg } {
  const out: { op?: Seg; ed?: Seg } = {};
  if (!a?.found || !(duration > 0)) return out;
  for (const r of a.results ?? []) {
    const len = r.episodeLength;
    const s = r.interval?.startTime;
    const e = r.interval?.endTime;
    if (!(len > 0) || !(s >= 0) || !(e > s) || Math.abs(len - duration) > 30) continue;
    if ((r.skipType === 'op' || r.skipType === 'mixed-op') && !out.op && e < len * 0.5) out.op = { s, e };
    if ((r.skipType === 'ed' || r.skipType === 'mixed-ed') && !out.ed && len - s <= len * 0.2)
      out.ed = { s: Math.max(0, duration - (len - s)), e: Math.min(duration, duration - (len - e)) };
  }
  return out;
}

/** Злити мітки за пріоритетом player → auto → aniskip; кінець, якого бракує, — +90 с. */
export function mergeMarks(d: number, player: { op?: Seg; ed?: Seg }, auto: { op?: Seg; ed?: Seg }, aniskip: { op?: Seg; ed?: Seg }): Marks {
  const pick = (k: 'op' | 'ed') => {
    for (const [src, m] of [['player', player], ['auto', auto], ['aniskip', aniskip]] as const) {
      const seg = m[k];
      if (!seg || !(seg.s >= 0) || (d > 0 && seg.s >= d)) continue;
      const e = seg.e > seg.s ? seg.e : seg.s + 90;
      return { s: seg.s, e: d > 0 ? Math.min(d, e) : e, src };
    }
    return undefined;
  };
  return { op: pick('op'), ed: pick('ed') };
}
