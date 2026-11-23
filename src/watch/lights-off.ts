/*
 * «Вимкнути світло» (MK 2026-11-23, 18:12): усе навколо плеєра затемнюється, як у кінотеатрі.
 * Свій елемент <hikka-plus-dim> прямо в body (власний Shadow DOM, чужий DOM не чіпаємо): чотири темні смуги навколо
 * прямокутника плеєра — щоб затемнення було над усім сайтом (і над липкою шапкою Hikka), а плеєр лишався клікабельним.
 * Клік по темному, Esc або повторна кнопка — світло назад. Положення плеєра стежимо кожен кадр (прокрутка, «Ширше»).
 */
import { useEffect } from 'react';

const DIM = 'rgba(0, 0, 0, 0.85)';

export function useLightsOff(target: HTMLElement | null, on: boolean, off: () => void) {
  useEffect(() => {
    if (!on || !target) return;
    const host = document.createElement('hikka-plus-dim');
    const root = host.attachShadow({ mode: 'open' });
    const parts = [0, 1, 2, 3].map(() => {
      const d = document.createElement('div');
      d.style.cssText = `position:fixed;background:${DIM};z-index:2147483000;opacity:0;transition:opacity .25s ease;cursor:pointer`;
      d.addEventListener('click', off);
      root.append(d);
      return d;
    });
    document.body.append(host);
    let raf = 0;
    let last = '';
    const place = () => {
      const r = target.getBoundingClientRect();
      const key = `${r.left},${r.top},${r.width},${r.height},${innerWidth},${innerHeight}`;
      if (key !== last) {
        last = key;
        const [t, b, l, rt] = parts as [HTMLDivElement, HTMLDivElement, HTMLDivElement, HTMLDivElement];
        const top = Math.max(0, r.top);
        const bottom = Math.min(innerHeight, r.bottom);
        Object.assign(t.style, { left: '0', top: '0', width: '100vw', height: `${top}px` });
        Object.assign(b.style, { left: '0', top: `${bottom}px`, width: '100vw', height: `${Math.max(0, innerHeight - bottom)}px` });
        Object.assign(l.style, { left: '0', top: `${top}px`, width: `${Math.max(0, r.left)}px`, height: `${Math.max(0, bottom - top)}px` });
        Object.assign(rt.style, { left: `${r.right}px`, top: `${top}px`, width: `${Math.max(0, innerWidth - r.right)}px`, height: `${Math.max(0, bottom - top)}px` });
      }
      raf = requestAnimationFrame(place);
    };
    place();
    requestAnimationFrame(() => parts.forEach((d) => (d.style.opacity = '1')));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && off();
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      host.remove();
    };
  }, [target, on]);
}
