/*
 * Лише всередині НАШОГО iframe плеєра (name="hikka-plus", див. PlayerFrame у src/watch/watch-block.tsx).
 *
 * Hikka Features вставляє у фрейми Ashdi/Moon на вкладці hikka.io стиль, що ховає рідну панель плеєра
 * (у своєму плеєрі він малює власну поверх) — і не відрізняє свій iframe від чужого. У нашому фреймі
 * прибираємо лише цей стиль; у фрейми Hikka Features (інше name) не втручаємося, сам плеєр не чіпаємо.
 * Розбір — claude/research-hf-player-conflict.md у claude.ai-проєкті (рішення MK 2026-11-23).
 */
import { PANEL_MSG } from '@/src/watch/types';

export const FRAME_NAME = 'hikka-plus';

// Характерні селектори стилів Hikka Features (integrations/iframe-player/*-bridge.ts, 3.1.21).
const FOREIGN_HIDE = ['pjsdiv:not(:has(video))', '.ma-player-wrap > :not(.plyr)'];

const isForeignHide = (n: Node): n is HTMLStyleElement =>
  n instanceof HTMLStyleElement &&
  (n.textContent?.length ?? 0) < 2000 &&
  /display:\s*none\s*!important/.test(n.textContent ?? '') &&
  FOREIGN_HIDE.some((s) => n.textContent!.includes(s));

export default defineContentScript({
  matches: ['https://ashdi.vip/vod/*', 'https://moonanime.art/iframe/*', 'https://moonanime.net/iframe/*'],
  allFrames: true,
  runAt: 'document_start',
  main() {
    if (window.parent === window || window.name !== FRAME_NAME) return;
    const sweep = (nodes: Iterable<Node>) => {
      for (const n of nodes) if (isForeignHide(n)) n.remove();
    };
    sweep(document.querySelectorAll('style'));
    const mo = new MutationObserver((recs) => recs.forEach((r) => sweep(r.addedNodes)));
    mo.observe(document.documentElement, { childList: true, subtree: true });
    // Hikka Features шукає плеєр до 15 с — після цього стежити немає сенсу.
    setTimeout(() => mo.disconnect(), 30_000);
    reportPanelSpace();
  },
});

/**
 * Рамка під панель (MK 2026-11-23, 03:34, «давай попробуем»): Moon у Firefox ставить свою панель ПІД відео,
 * тож у рамці 16:9 відео стискається й з'являються смуги збоку. Лише ЧИТАЄМО розміри: скільки висоти фрейму
 * не зайнято самим зображенням (панель) — і кажемо батьківській сторінці (hikka.io), щоб рамка стала вищою
 * на стільки. Там, де панель поверх відео, виходить 0 — рамка лишається 16:9. Плеєр не чіпаємо.
 */

function reportPanelSpace() {
  let last = -1;
  const measure = () => {
    let best: HTMLVideoElement | null = null;
    let area = 0;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      if (r.width * r.height > area && v.videoWidth > 0) {
        best = v;
        area = r.width * r.height;
      }
    }
    if (!best) return;
    const r = best.getBoundingClientRect();
    const a = best.videoWidth / best.videoHeight;
    if (!(a > 0.5 && a < 4)) return;
    // Видима картинка при object-fit: contain.
    const shownH = Math.min(r.height, r.width / a);
    const extra = Math.max(0, Math.min(200, Math.round((window.innerHeight - shownH) / 4) * 4));
    if (Math.abs(extra - last) < 4) return;
    last = extra;
    window.parent.postMessage({ type: PANEL_MSG, extra }, 'https://hikka.io');
  };
  let t = 0;
  const schedule = () => {
    clearTimeout(t);
    t = window.setTimeout(measure, 150);
  };
  const ro = new ResizeObserver(schedule);
  const hook = () => document.querySelectorAll('video').forEach((v) => {
    ro.observe(v);
    v.addEventListener('loadedmetadata', schedule);
  });
  window.addEventListener('resize', schedule);
  // Плеєр будує відео не одразу.
  const iv = window.setInterval(() => {
    hook();
    schedule();
  }, 1000);
  setTimeout(() => clearInterval(iv), 20_000);
}
