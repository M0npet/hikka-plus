/*
 * Режим «Ширше» (рішення MK 2026-11-23, 01:59): плеєр на всю ширину сітки сторінки — на своєму місці,
 * під верхніми картками лівої й правої колонок; усе, що нижче, з'їжджає вниз.
 *
 * DOM Hikka не змінюємо: у бічні колонки вставляємо лише свої порожні відступи `hikka-plus-gap`,
 * у центрі місце тримає наш власний блок (slot), а сам плеєр лежить у нашому host `hikka-plus-theater`
 * з position:absolute поверх сітки. Перераховуємо при зміні розмірів і перебудові колонок.
 */
import { useEffect, useState } from 'react';

const GAP = 32; // gap-8 у колонках Hikka
const TOP_CARDS = 2; // скільки верхніх карток бічної колонки завжди над блоком
const SIDES = ['#content-left-side', '#content-right-side'] as const;

/** Відступ над плеєром у центральному блоці (px) — скільки опустити плеєр під бічні картки. */
export function useWideLayout(
  active: boolean,
  slot: HTMLElement | null,
  stage: HTMLElement | null,
  theater: HTMLElement | null,
  onUnavailable: () => void,
) {
  const [offset, setOffset] = useState(0);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!active || !slot || !stage || !theater) return;
    const host = (theater.getRootNode() as ShadowRoot).host as HTMLElement | undefined;
    const grid = document.querySelector<HTMLElement>('div:has(> #content-left-side)');
    if (!host || !grid) return;
    const gaps = new Map<Element, HTMLElement>();
    let raf = 0;
    let lastOffset = -1;
    let lastH = -1;

    const pageTop = (el: Element) => el.getBoundingClientRect().top + window.scrollY;
    const pageBottom = (el: Element) => el.getBoundingClientRect().bottom + window.scrollY;
    const shown = (el: Element) => !(el instanceof HTMLElement) || (el.offsetParent !== null && el.getBoundingClientRect().height > 0);

    const run = () => {
      raf = 0;
      const left = document.querySelector<HTMLElement>(SIDES[0]);
      // Вузький екран: колонки складаються в одну — «Ширше» не має сенсу.
      if (!left || getComputedStyle(left).display === 'none') {
        onUnavailable();
        return;
      }
      const H = Math.round(stage.getBoundingClientRect().height);
      // Верх місця в центрі (відступ у slot — padding, тож верх рамки природний).
      const slotTop = pageTop(slot);

      // Для кожної бічної колонки: дитина, що перетинає верх плеєра, і де вставити відступ.
      const plans: { col: Element; before: Element | null; prevBottom: number }[] = [];
      let top = slotTop;
      for (const sel of SIDES) {
        const col = document.querySelector(sel);
        if (!col) continue;
        const kids = [...col.children].filter((k) => k.tagName.toLowerCase() !== 'hikka-plus-gap' && shown(k));
        let prevBottom = pageTop(col) - GAP;
        let before: Element | null = null;
        for (const [i, k] of kids.entries()) {
          const b = pageBottom(k);
          // Рішення MK (03:20): «щоб завжди однаково». Над блоком — завжди дві верхні картки кожної бічної колонки
          // (зліва обкладинка з кнопками й оцінка/серії, справа оцінка MAL та інфо) і все, що повністю вище місця блоку
          // (довгий опис); решта з'їжджає під блок. Від довжини опису розкладка не залежить.
          if (i >= TOP_CARDS && b > slotTop + 1) {
            before = k;
            break;
          }
          if (b > slotTop) top = Math.max(top, b + GAP);
          prevBottom = b;
        }
        plans.push({ col, before, prevBottom });
      }

      for (const { col, before, prevBottom } of plans) {
        let gap = gaps.get(col);
        if (!gap) {
          gap = document.createElement('hikka-plus-gap');
          gap.setAttribute('aria-hidden', 'true');
          gap.style.cssText = 'display:block;flex:none;width:100%;pointer-events:none';
          gaps.set(col, gap);
        }
        const target = before && before.parentNode === col ? before : null;
        if (gap.parentNode !== col || gap.nextElementSibling !== target) col.insertBefore(gap, target);
        // Відступ починається на GAP нижче попередньої картки; наступна картка — на GAP нижче плеєра.
        const h = Math.max(0, Math.round(top + H - (prevBottom + GAP)));
        if (gap.style.height !== `${h}px`) gap.style.height = `${h}px`;
      }

      const off = Math.round(top - slotTop);
      if (off !== lastOffset) {
        lastOffset = off;
        setOffset(off);
      }
      if (H !== lastH) {
        lastH = H;
        setHeight(H);
      }

      // Сам плеєр: абсолютно, ширина сітки, верх = верх місця в центрі.
      const g = grid.getBoundingClientRect();
      host.style.position = 'absolute';
      host.style.zIndex = '1';
      host.style.width = `${Math.round(g.width)}px`;
      const hr = host.getBoundingClientRect();
      const curTop = parseFloat(host.style.top) || 0;
      const curLeft = parseFloat(host.style.left) || 0;
      host.style.top = `${Math.round(curTop + (top - window.scrollY) - hr.top)}px`;
      host.style.left = `${Math.round(curLeft + g.left - hr.left)}px`;
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(run);
    };

    const ro = new ResizeObserver(schedule);
    ro.observe(grid);
    ro.observe(stage);
    const mo = new MutationObserver((recs) => {
      // Свої зміни (відступи) не рахуємо — лише перебудову колонок самою Hikka.
      if (recs.some((r) => [...r.addedNodes, ...r.removedNodes].some((n) => (n as Element).tagName?.toLowerCase() !== 'hikka-plus-gap'))) schedule();
    });
    for (const sel of [...SIDES, '#content-center']) {
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
      gaps.forEach((g) => g.remove());
      for (const k of ['position', 'zIndex', 'width', 'top', 'left'] as const) host.style[k] = '';
      setOffset(0);
      setHeight(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, slot, stage, theater]);

  return { offset, height };
}
