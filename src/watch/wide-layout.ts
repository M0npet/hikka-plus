/*
 * Режим «Ширше» (рішення MK 2026-11-23, 01:59): плеєр на всю ширину сітки сторінки — на своєму місці,
 * під верхніми картками лівої й правої колонок; усе, що нижче, з'їжджає вниз.
 *
 * DOM Hikka не змінюємо: у бічні колонки вставляємо лише свої порожні відступи `hikka-plus-gap`,
 * у центрі місце тримає наш власний блок (slot), а сам плеєр лежить у нашому host `hikka-plus-theater`
 * з position:absolute поверх сітки. Перераховуємо при зміні розмірів і перебудові колонок.
 */
import { useEffect, useRef, useState } from 'react';

const GAP = 32; // gap-8 у колонках Hikka
// Скільки верхніх карток бічної колонки завжди над блоком (hikka-next, content-detail-page.tsx):
// зліва перша дитина — обкладинка + кнопки + оцінка/серії/нотатка однією обгорткою (далі «Відстежується»),
// справа — оцінки MAL і інфо.
const SIDES = [
  { sel: '#content-left-side', top: 1 },
  { sel: '#content-right-side', top: 2 },
] as const;
const OWN = new Set(['hikka-plus-gap', 'hikka-plus-watch']);

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
  const restoreRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!active || !slot || !stage || !theater) return;
    const host = (theater.getRootNode() as ShadowRoot).host as HTMLElement | undefined;
    const grid = document.querySelector<HTMLElement>('div:has(> #content-left-side)');
    // Наш блок у центральній колонці (у ньому лише slot) — його й пересуваємо нижче, щоб центр Hikka заповнив порожнечу.
    const own = (slot.getRootNode() as ShadowRoot).host as HTMLElement | undefined;
    if (!host || !grid || !own) return;
    const home = { parent: own.parentNode, next: own.nextSibling };
    /** Повернути наш блок на рідне місце (до перемикання назад, щоб iframe не переїжджав і не перезавантажувався). */
    const restore = () => {
      const desc = document.getElementById('content-description');
      const want = desc?.parentNode === own.parentNode ? desc!.nextSibling : home.next?.parentNode === home.parent ? home.next : null;
      if (own.previousSibling === desc || (!desc && own.nextSibling === want)) return;
      if (desc && desc.parentNode) desc.parentNode.insertBefore(own, desc.nextSibling);
      else if (home.parent) home.parent.insertBefore(own, want);
    };
    restoreRef.current = restore;
    const gaps = new Map<Element, HTMLElement>();
    let raf = 0;
    let lastOffset = -1;
    let lastH = -1;

    const pageTop = (el: Element) => el.getBoundingClientRect().top + window.scrollY;
    const pageBottom = (el: Element) => el.getBoundingClientRect().bottom + window.scrollY;
    const shown = (el: Element) => !(el instanceof HTMLElement) || (el.offsetParent !== null && el.getBoundingClientRect().height > 0);

    const run = () => {
      raf = 0;
      const left = document.querySelector<HTMLElement>(SIDES[0].sel);
      // Вузький екран: колонки складаються в одну — «Ширше» не має сенсу.
      if (!left || getComputedStyle(left).display === 'none') {
        onUnavailable();
        return;
      }
      const H = Math.round(stage.getBoundingClientRect().height);
      const center = own.parentElement;
      const desc = document.getElementById('content-description');
      const cGap = center ? parseFloat(getComputedStyle(center).rowGap) || GAP : GAP;
      // Рідне місце блоку — одразу під описом (не залежить від того, куди ми його вже пересунули).
      const slotTop = desc && desc.parentElement === center ? pageBottom(desc) + cGap : pageTop(slot);

      // Для кожної бічної колонки: дитина, що перетинає верх плеєра, і де вставити відступ.
      const plans: { col: Element; before: Element | null; prevBottom: number }[] = [];
      let top = slotTop;
      for (const { sel, top: topCards } of SIDES) {
        const col = document.querySelector(sel);
        if (!col) continue;
        const kids = [...col.children].filter((k) => k.tagName.toLowerCase() !== 'hikka-plus-gap' && shown(k));
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

      // Порожнеча в центрі над блоком (короткий опис) — MK 03:48 «щоб заповнювалося те, що влазить»:
      // картки центру Hikka після опису («Головні персонажі», «Автори»…), що повністю влазять, лишаються над блоком —
      // для цього пересуваємо НАШ блок нижче за них (DOM Hikka не чіпаємо).
      if (center && desc && desc.parentElement === center) {
        let y = pageBottom(desc);
        let after: Element = desc;
        for (let el = desc.nextElementSibling; el; el = el.nextElementSibling) {
          if (el === own || OWN.has(el.tagName.toLowerCase())) continue;
          if (!shown(el)) continue;
          const h = el.getBoundingClientRect().height;
          if (y + cGap + h + cGap > top + 1) break;
          y += cGap + h;
          after = el;
        }
        if (own.previousElementSibling !== after || own.parentNode !== center) center.insertBefore(own, after.nextSibling);
      }
      const off = Math.max(0, Math.round(top - pageTop(slot)));
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
      gaps.forEach((g) => g.remove());
      restore();
      restoreRef.current = () => {};
      for (const k of ['position', 'zIndex', 'width', 'top', 'left'] as const) host.style[k] = '';
      setOffset(0);
      setHeight(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, slot, stage, theater]);

  return { offset, height, restore: () => restoreRef.current() };
}
