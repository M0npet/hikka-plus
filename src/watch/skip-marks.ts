/*
 * Мітки опенінгу й ендингу (MK 2026-11-23, 18:07): смужка під плеєром, кнопка «Пропустити», автопропуск.
 *
 * Звідки мітки (за пріоритетом):
 *  1) player  — мітки самого плеєра (Moon get_skip_segments; Fenix — зі смужки прокрутки через скрипт у фреймі);
 *  2) aniskip — краудсорс під чужий реліз: лише з перевіркою тривалості (OP ±90 с, ED ±60 с), ED рахуємо від кінця.
 * Свій пошук за кадрами (відбитки, сканер, «Тут опенінг») прибрано в 0.6.0 — грузив процесор (MK 22:37: «потом разберемся»).
 */

export type Seg = { s: number; e: number };
export type MarkSrc = 'player' | 'aniskip';
export type Marks = { op?: Seg & { src: MarkSrc }; ed?: Seg & { src: MarkSrc } };

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

/** AniSkip під тривалість у плеєрі (OP ±90 с, ED ±60 с): OP — від початку, ED — від кінця (фандаб буває довшим/коротшим). */
export function segsFromAniskip(a: AniSkip | null, duration: number): { op?: Seg; ed?: Seg } {
  const out: { op?: Seg; ed?: Seg } = {};
  if (!a?.found || !(duration > 0)) return out;
  for (const r of a.results ?? []) {
    const len = r.episodeLength;
    const s = r.interval?.startTime;
    const e = r.interval?.endTime;
    if (!(len > 0) || !(s >= 0) || !(e > s)) continue;
    const diff = Math.abs(len - duration);
    // Допуск ширший, ніж був (±30 с; MK 2026-11-26 17:34 «не все тайтлы находит»): наші релізи часто довші/коротші за
    // японський TV-реліз (заставка команди, анонс). OP рахуємо від початку — ±90 с; ED від кінця — ±60 с.
    if ((r.skipType === 'op' || r.skipType === 'mixed-op') && !out.op && diff <= 90 && e < Math.min(len, duration) * 0.5) out.op = { s, e };
    if ((r.skipType === 'ed' || r.skipType === 'mixed-ed') && !out.ed && diff <= 60 && len - s <= len * 0.2)
      out.ed = { s: Math.max(0, duration - (len - s)), e: Math.min(duration, duration - (len - e)) };
  }
  return out;
}

/** Злити мітки за пріоритетом player → aniskip; кінець, якого бракує, — +90 с. */
export function mergeMarks(d: number, player: { op?: Seg; ed?: Seg }, aniskip: { op?: Seg; ed?: Seg }): Marks {
  const pick = (k: 'op' | 'ed') => {
    for (const [src, m] of [['player', player], ['aniskip', aniskip]] as const) {
      const seg = m[k];
      if (!seg || !(seg.s >= 0) || (d > 0 && seg.s >= d)) continue;
      const e = seg.e > seg.s ? seg.e : seg.s + 90;
      return { s: seg.s, e: d > 0 ? Math.min(d, e) : e, src };
    }
    return undefined;
  };
  return { op: pick('op'), ed: pick('ed') };
}
