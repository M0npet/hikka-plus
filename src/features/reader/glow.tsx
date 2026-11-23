import { useEffect, useRef } from 'react';

/** Розмір canvas підсвітки по ширині; висота — за пропорцією екрана. Далі CSS розтягує й розмиває. */
const GLOW_W = 48;
/** Наскільки ширшою за сторінку малюємо її копію (кольори виходять за краї й м'яко гаснуть). */
const SPREAD = 1.8;
/** Плавність: частка нового кадру за один крок і скільки кроків малювати після зміни (~0,5 с). */
const BLEND = 0.18;
const FRAMES = 28;

/**
 * Підсвітка читалки манґи/манхви (MK 22:18–22:20): кольори видимої частини сторінки м'яко
 * розходяться по фону, як у плеєра. Малюємо в маленький canvas прямо з уже завантажених `<img>`
 * читалки (нових запитів немає, Referer той самий); пікселі НЕ читаємо — canvas може бути
 * «заражений» чужим доменом, показувати його це не заважає. Кожну видиму сторінку малюємо
 * ширшою за неї саму (SPREAD), по вертикалі — там, де вона зараз видна: у стрічці колір іде за прокруткою,
 * у посторінковому — плавна зміна при гортанні.
 */
export function ReaderGlow({
  root,
  scroll,
  level,
  bright,
  tick,
}: {
  root: HTMLElement | null;
  scroll: HTMLElement | null;
  /** Непрозорість 0..100. */
  level: number;
  /** Яскравість кольорів, %. */
  bright: number;
  /** Змінюється при гортанні / новому розділі — перемалювати. */
  tick: unknown;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const kick = useRef<() => void>(() => {});

  useEffect(() => {
    const out = ref.current;
    if (!out || !root || !scroll) return;
    const octx = out.getContext('2d');
    const tgt = document.createElement('canvas');
    const tctx = tgt.getContext('2d');
    if (!octx || !tctx) return;
    octx.imageSmoothingQuality = 'high';
    tctx.imageSmoothingQuality = 'high';

    let raf = 0;
    let left = 0;
    let first = true;

    const size = () => {
      const r = root.getBoundingClientRect();
      const h = Math.max(1, Math.round((GLOW_W * r.height) / Math.max(1, r.width)));
      if (out.width !== GLOW_W || out.height !== h) {
        out.width = tgt.width = GLOW_W;
        out.height = tgt.height = h;
        first = true;
      }
      return r;
    };

    const draw = () => {
      const box = size();
      const cw = tgt.width;
      const ch = tgt.height;
      tctx.globalAlpha = 1;
      tctx.fillStyle = getComputedStyle(root).backgroundColor || '#000';
      tctx.fillRect(0, 0, cw, ch);
      const H = box.height;
      for (const img of scroll.querySelectorAll<HTMLImageElement>('.hp-page img, .hp-strip__pg img')) {
        if (!img.complete || !img.naturalWidth) continue;
        const r = img.getBoundingClientRect();
        const top = Math.max(r.top - box.top, 0);
        const bot = Math.min(r.bottom - box.top, H);
        if (bot <= top || r.height < 1) continue;
        const sy = ((top - (r.top - box.top)) / r.height) * img.naturalHeight;
        const sh = ((bot - top) / r.height) * img.naturalHeight;
        // По горизонталі — копія ширша за сторінку в SPREAD разів, з тим самим центром.
        const W = box.width;
        const cx = (r.left + r.right) / 2 - box.left;
        const dw = Math.min(W, r.width * SPREAD);
        try {
          tctx.drawImage(
            img,
            0,
            sy,
            img.naturalWidth,
            Math.max(1, sh),
            ((cx - dw / 2) / W) * cw,
            (top / H) * ch,
            (dw / W) * cw,
            Math.max(1, ((bot - top) / H) * ch),
          );
        } catch {
          /* картинка ще не декодована — наступного кадру */
        }
      }
      octx.globalAlpha = first ? 1 : BLEND;
      octx.drawImage(tgt, 0, 0);
      first = false;
    };

    const loop = () => {
      raf = 0;
      draw();
      if (--left > 0) raf = requestAnimationFrame(loop);
    };
    const dirty = () => {
      left = FRAMES;
      if (!raf) raf = requestAnimationFrame(loop);
    };
    kick.current = dirty;

    // load не спливає — ловимо на фазі перехоплення.
    scroll.addEventListener('scroll', dirty, { passive: true });
    scroll.addEventListener('load', dirty, true);
    window.addEventListener('resize', dirty);
    dirty();
    return () => {
      cancelAnimationFrame(raf);
      scroll.removeEventListener('scroll', dirty);
      scroll.removeEventListener('load', dirty, true);
      window.removeEventListener('resize', dirty);
      kick.current = () => {};
    };
  }, [root, scroll]);

  useEffect(() => kick.current(), [tick]);

  return (
    <canvas
      ref={ref}
      className="hp-glow"
      aria-hidden="true"
      style={{ opacity: level / 100, ['--hp-glow-b' as string]: `${bright}%` }}
    />
  );
}
