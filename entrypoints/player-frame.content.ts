/*
 * Лише всередині НАШОГО iframe плеєра (name="hikka-plus", див. PlayerFrame у src/watch/watch-block.tsx).
 *
 * Лише міряє, скільки висоти фрейму займає панель плеєра під відео (Moon у Firefox), і каже про це hikka.io.
 * Плеєр не чіпаємо.
 *
 * Раніше (0.5.2–0.5.5) тут ще прибирали стиль Hikka Features, що ховав рідну панель Ashdi/Moon і в нашому фреймі.
 * Hikka Features 3.1.22 це виправив (свій iframe `#hikka-features-player` + перевірка через батьківську сторінку) —
 * обхід прибрано (MK 2026-11-23, 14:26). Розбір — claude/research-hf-player-conflict.md у claude.ai-проєкті.
 */
import { PANEL_MSG } from '@/src/watch/types';

export const FRAME_NAME = 'hikka-plus';

export default defineContentScript({
  matches: ['https://ashdi.vip/vod/*', 'https://moonanime.art/iframe/*', 'https://moonanime.net/iframe/*'],
  allFrames: true,
  runAt: 'document_idle',
  main() {
    if (window.parent === window || window.name !== FRAME_NAME) return;
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
