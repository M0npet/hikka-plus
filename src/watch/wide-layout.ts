/*
 * Режим «Ширше» (рішення MK 2026-11-23, 01:59): плеєр на всю ширину сітки сторінки — на своєму місці,
 * під верхніми картками лівої й правої колонок; усе, що нижче, з'їжджає вниз.
 *
 * 0.5.12 (MK 15:54 «щоб плеєр не перезавантажувався» + анімація): наш host `hikka-plus-watch` НЕ переїжджає
 * в DOM (перенесення iframe = перезавантаження) — він лишається на своєму місці в центральній колонці, лише стає
 * position:absolute на ширину сітки. Місце під ним тримають наші порожні відступи `hikka-plus-gap`: у бічних колонках
 * і в центрі. DOM Hikka не змінюємо. Перехід туди й назад — FLIP-анімація transform (без перерахунку розкладки щокадру).
 */
import { useLayoutEffect, useRef } from 'react';

const GAP = 32; // gap-8 у колонках Hikka
// Скільки верхніх карток бічної колонки завжди над блоком (hikka-next, content-detail-page.tsx):
// зліва перша дитина — обкладинка + кнопки + оцінка/серії/нотатка однією обгорткою (далі «Відстежується»),
// справа — оцінки MAL і інфо.
const SIDES = [
  { sel: '#content-left-side', top: 1 },
  { sel: '#content-right-side', top: 2 },
] as const;
const OWN = new Set(['hikka-plus-gap', 'hikka-plus-watch']);

/** FLIP: елемент уже на новому місці — показати перехід зі старого прямокутника `from`. */
/** prefers-reduced-motion не враховуємо — MK 16:45: «показувати завжди», тривалість — повзунком (0 = без анімації). */
function flip(el: HTMLElement, from: DOMRect, ms: number) {
  if (ms <= 0 || !from.width || !from.height || typeof el.animate !== 'function') return;
  const to = el.getBoundingClientRect();
  if (!to.width || !to.height) return;
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  const sx = from.width / to.width;
  const sy = from.height / to.height;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return;
  el.animate(
    [
      { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
      { transformOrigin: '0 0', transform: 'none' },
    ],
    { duration: ms, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
  );
}

/**
 * Увімкнути «Ширше» для блоку, у якому лежить `stage`. Нічого не повертає: усе робиться стилями нашого host
 * і нашими відступами. `onUnavailable` — коли «Ширше» неможливе (вузький екран, колонки складені в одну).
 */
export function useWideLayout(active: boolean, stage: HTMLElement | null, onUnavailable: () => void, animMs = 320) {
  const anim = useRef(animMs);
  anim.current = animMs;
  useLayoutEffect(() => {
    if (!active || !stage) return;
    const host = (stage.getRootNode() as ShadowRoot).host as HTMLElement | undefined;
    const grid = document.querySelector<HTMLElement>('div:has(> #content-left-side)');
    if (!host || !grid) return;
    const from = host.getBoundingClientRect();
    const gaps = new Map<Element, HTMLElement>();
    let raf = 0;
    let first = true;

    const pageTop = (el: Element) => el.getBoundingClientRect().top + window.scrollY;
    const pageBottom = (el: Element) => el.getBoundingClientRect().bottom + window.scrollY;
    const shown = (el: Element) => !(el instanceof HTMLElement) || (el.offsetParent !== null && el.getBoundingClientRect().height > 0);
    const gapFor = (col: Element) => {
      let gap = gaps.get(col);
      if (!gap) {
        gap = document.createElement('hikka-plus-gap');
        gap.setAttribute('aria-hidden', 'true');
        gap.style.cssText = 'display:block;flex:none;width:100%;pointer-events:none';
        gaps.set(col, gap);
      }
      return gap;
    };
    const setH = (gap: HTMLElement, h: number) => {
      if (gap.style.height !== `${h}px`) gap.style.height = `${h}px`;
    };
    /** Початок координат для position:absolute нашого host (padding box containing block), у координатах сторінки. */
    const origin = () => {
      const op = host.offsetParent as HTMLElement | null;
      if (!op || (op === document.body && getComputedStyle(op).position === 'static')) return { x: 0, y: 0 };
      const r = op.getBoundingClientRect();
      return { x: r.left + window.scrollX + op.clientLeft, y: r.top + window.scrollY + op.clientTop };
    };

    const run = () => {
      raf = 0;
      const left = document.querySelector<HTMLElement>(SIDES[0].sel);
      // Вузький екран: колонки складаються в одну — «Ширше» не має сенсу.
      if (!left || getComputedStyle(left).display === 'none') {
        onUnavailable();
        return;
      }
      const center = host.parentElement;
      const desc = document.getElementById('content-description');
      const cGap = center ? parseFloat(getComputedStyle(center).rowGap) || GAP : GAP;

      // Сам блок: абсолютно, ширина сітки (висоту бере від ширини — рахуємо після).
      const g = grid.getBoundingClientRect();
      host.style.position = 'absolute';
      host.style.zIndex = '1';
      host.style.width = `${Math.round(g.width)}px`;
      const H = Math.round(stage.getBoundingClientRect().height);

      // Рідне місце блоку — одразу під описом.
      const slotTop = desc && desc.parentElement === center ? pageBottom(desc) + cGap : center ? pageTop(center) : pageTop(grid);

      // Для кожної бічної колонки: дитина, що перетинає верх плеєра, і де вставити відступ.
      const plans: { col: Element; before: Element | null; prevBottom: number }[] = [];
      let top = slotTop;
      for (const { sel, top: topCards } of SIDES) {
        const col = document.querySelector(sel);
        if (!col) continue;
        const kids = [...col.children].filter((k) => !OWN.has(k.tagName.toLowerCase()) && shown(k));
        let prevBottom = pageTop(col) - GAP;
        let before: Element | null = null;
        for (const [i, k] of kids.entries()) {
          const b = pageBottom(k);
          // Рішення MK (03:20): «щоб завжди однаково». Над блоком — завжди верхні картки бічних колонок
          // (зліва обкладинка з кнопками й оцінка/серії, справа оцінка MAL та інфо) і все, що повністю вище місця блоку
          // (довгий опис); решта з'їжджає під блок. Від довжини опису розкладка не залежить.
          if (i >= topCards && b > slotTop + 1) {
            before = k;
            break;
          }
          if (b > slotTop) top = Math.max(top, b + GAP);
          prevBottom = b;
        }
        plans.push({ col, before, prevBottom });
      }

      for (const { col, before, prevBottom } of plans) {
        const gap = gapFor(col);
        const target = before && before.parentNode === col ? before : null;
        if (gap.parentNode !== col || gap.nextElementSibling !== target) col.insertBefore(gap, target);
        // Відступ починається на GAP нижче попередньої картки; наступна картка — на GAP нижче плеєра.
        setH(gap, Math.max(0, Math.round(top + H - (prevBottom + GAP))));
      }

      // Центр: картки Hikka після опису («Головні персонажі», «Автори»…), що повністю влазять у порожнечу над блоком,
      // лишаються над ним (MK 03:48); далі — наш відступ на висоту блоку.
      if (center) {
        let y = desc && desc.parentElement === center ? pageBottom(desc) : pageTop(center) - cGap;
        let after: Element | null = desc && desc.parentElement === center ? desc : null;
        for (let el = after ? after.nextElementSibling : center.firstElementChild; el; el = el.nextElementSibling) {
          if (OWN.has(el.tagName.toLowerCase())) continue;
          if (!shown(el)) continue;
          const h = el.getBoundingClientRect().height;
          if (y + cGap + h + cGap > top + 1) break;
          y += cGap + h;
          after = el;
        }
        const gap = gapFor(center);
        const next = after ? after.nextSibling : center.firstChild;
        if (gap.parentNode !== center || (gap !== next && gap.previousElementSibling !== after)) center.insertBefore(gap, next);
        setH(gap, Math.max(0, Math.round(top + H - (y + cGap))));
      }

      // Позиція блоку: верх = під верхніми бічними картками, ліво = ліво сітки.
      const o = origin();
      host.style.top = `${Math.round(top - o.y)}px`;
      host.style.left = `${Math.round(g.left + window.scrollX - o.x)}px`;

      if (first) {
        first = false;
        flip(host, from, anim.current);
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(run);
    };

    const ro = new ResizeObserver(schedule);
    ro.observe(grid);
    ro.observe(stage);
    const mo = new MutationObserver((recs) => {
      // Свої зміни (відступи) не рахуємо — лише перебудову колонок самою Hikka.
      if (recs.some((r) => [...r.addedNodes, ...r.removedNodes].some((n) => !OWN.has((n as Element).tagName?.toLowerCase() ?? '')))) schedule();
    });
    for (const sel of [...SIDES.map((x) => x.sel), '#content-center']) {
      const col = document.querySelector(sel);
      if (col) {
        mo.observe(col, { childList: true });
        [...col.children].forEach((k) => ro.observe(k));
      }
    }
    window.addEventListener('resize', schedule);
    run();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', schedule);
      const was = host.getBoundingClientRect();
      gaps.forEach((g) => g.remove());
      for (const k of ['position', 'zIndex', 'width', 'top', 'left'] as const) host.style[k] = '';
      if (host.isConnected) flip(host, was, anim.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stage]);
}
