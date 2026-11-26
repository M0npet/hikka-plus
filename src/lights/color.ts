/* Кольори для пристроїв із кадру 32×18. */
import type { Frame, RGB } from './types';

/** Глибина смуги краю, px кадру (з 18 по висоті). */
const DEPTH = 3;

/** Середній колір прямокутника [x0,x1)×[y0,y1). */
function avg(f: Frame, x0: number, y0: number, x1: number, y1: number): RGB {
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  for (let y = Math.max(0, y0); y < Math.min(f.h, y1); y++)
    for (let x = Math.max(0, x0); x < Math.min(f.w, x1); x++) {
      const i = (y * f.w + x) * 3;
      r += f.rgb.charCodeAt(i);
      g += f.rgb.charCodeAt(i + 1);
      b += f.rgb.charCodeAt(i + 2);
      n++;
    }
  return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [0, 0, 0];
}

export const average = (f: Frame) => avg(f, 0, 0, f.w, f.h);

export type Side = 'left' | 'top' | 'right' | 'bottom';

/**
 * n зон уздовж сторони, за годинниковою стрілкою з боку глядача:
 * ліва — знизу вгору, верх — зліва направо, права — згори вниз, низ — справа наліво.
 */
export function edge(f: Frame, side: Side, n: number): RGB[] {
  const out: RGB[] = [];
  const vertical = side === 'left' || side === 'right';
  const len = vertical ? f.h : f.w;
  for (let k = 0; k < n; k++) {
    const rev = side === 'left' || side === 'bottom';
    const i = rev ? n - 1 - k : k;
    const a = Math.floor((i * len) / n);
    const z = Math.max(a + 1, Math.floor(((i + 1) * len) / n));
    if (side === 'left') out.push(avg(f, 0, a, DEPTH, z));
    else if (side === 'right') out.push(avg(f, f.w - DEPTH, a, f.w, z));
    else if (side === 'top') out.push(avg(f, a, 0, z, DEPTH));
    else out.push(avg(f, a, f.h - DEPTH, z, f.h));
  }
  return out;
}

/**
 * n світлодіодів навколо екрана: стрічка від лівого нижнього кута вгору, далі за годинниковою стрілкою
 * (найчастіший монтаж TV-стрічки). Світлодіоди ділимо між сторонами пропорційно довжині (16:9).
 */
export function perimeter(f: Frame, n: number): RGB[] {
  const total = 2 * (f.w + f.h);
  const sides: [Side, number][] = [
    ['left', f.h],
    ['top', f.w],
    ['right', f.h],
    ['bottom', f.w],
  ];
  const out: RGB[] = [];
  let used = 0;
  sides.forEach(([s, len], i) => {
    const cnt = i === 3 ? n - used : Math.round((n * len) / total);
    used += cnt;
    if (cnt > 0) out.push(...edge(f, s, cnt));
  });
  return out;
}

/** Помітна зміна кольору (щоб не слати повільним пристроям те саме). */
export const differs = (a: RGB | null, b: RGB, d = 6) =>
  !a || Math.abs(a[0] - b[0]) > d || Math.abs(a[1] - b[1]) > d || Math.abs(a[2] - b[2]) > d;

export const hex = (c: RGB) => c.map((v) => v.toString(16).padStart(2, '0')).join('');

/** Однотонний кадр — для кнопки «Перевірити». */
export function solid(c: RGB, w = 32, h = 18): Frame {
  return { w, h, rgb: String.fromCharCode(...c).repeat(w * h) };
}
