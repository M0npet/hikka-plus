/*
 * Відбиток кадру для міток OP/ED (src/watch/skip-marks.ts). Окремим файлом без імпортів — його бере
 * скрипт у фреймі плеєра (entrypoints/player-frame.content.ts).
 */

/** Невідомий відбиток (темний/однотонний кадр або пропуск) — не збігається й не рве збіг. */
export const FLAT = -1;
/** Кроків відбитка на секунду відео. */
export const FP_RATE = 2;

/** RGBA 32×18 → 32-бітний відбиток або FLAT. */
export function frameHash(px: ArrayLike<number>, w: number, h: number): number {
  const GX = 8;
  const GY = 4;
  const lum = new Array<number>(GX * GY).fill(0);
  const cnt = new Array<number>(GX * GY).fill(0);
  for (let y = 0; y < h; y++) {
    const gy = Math.min(GY - 1, Math.floor((y * GY) / h));
    for (let x = 0; x < w; x++) {
      const gx = Math.min(GX - 1, Math.floor((x * GX) / w));
      const i = (y * w + x) * 4;
      lum[gy * GX + gx]! += 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
      cnt[gy * GX + gx]!++;
    }
  }
  const v = lum.map((l, i) => l / (cnt[i] || 1));
  const sorted = [...v].sort((a, b) => a - b);
  if (sorted[sorted.length - 1]! - sorted[0]! < 16) return FLAT; // чорний/однотонний кадр — нічого не каже
  const med = (sorted[15]! + sorted[16]!) / 2;
  let hsh = 0;
  for (let i = 0; i < 32; i++) if (v[i]! > med) hsh |= 1 << i;
  return hsh >>> 0;
}

