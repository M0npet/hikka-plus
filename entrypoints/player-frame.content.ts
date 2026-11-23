/*
 * Лише всередині НАШОГО iframe плеєра (name="hikka-plus", див. PlayerFrame у src/watch/watch-block.tsx).
 *
 * Hikka Features вставляє у фрейми Ashdi/Moon на вкладці hikka.io стиль, що ховає рідну панель плеєра
 * (у своєму плеєрі він малює власну поверх) — і не відрізняє свій iframe від чужого. У нашому фреймі
 * прибираємо лише цей стиль; у фрейми Hikka Features (інше name) не втручаємося, сам плеєр не чіпаємо.
 * Розбір — claude/research-hf-player-conflict.md у claude.ai-проєкті (рішення MK 2026-11-23).
 */
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
  },
});
