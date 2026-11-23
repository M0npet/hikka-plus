/*
 * Лише всередині НАШОГО iframe плеєра (name="hikka-plus", див. PlayerFrame у src/watch/watch-block.tsx).
 *
 * Підсвітка навколо плеєра (MK 2026-11-23, 14:48, як Ambient mode на YouTube): раз на ~0.1 с зменшуємо поточний кадр
 * відео до 32×18 і шлемо пікселі (рядок RGB) на hikka.io — там їх розмивають за рамкою. Лише ЧИТАЄМО кадр, плеєр не чіпаємо.
 * Працює, лише коли hikka.io попросив (вимикач «Підсвітка» в налаштуваннях плеєра). Якщо кадр прочитати не можна
 * (відео з чужого сервера без CORS) — кажемо про це один раз і більше не пробуємо.
 *
 * Для Moon ще кажемо, який вигляд панелі вибрано в самому плеєрі ({bar}) — рамка під «Під кадром» вища.
 *
 * Мітки OP/ED (MK 18:07, src/watch/skip-marks.ts): якщо hikka.io просить ({scan}), з того самого зменшеного кадру
 * двічі на секунду відео рахуємо 32-бітний відбиток і шлемо пачками ({fp: "крок,відбиток;…", d}) — кадри нікуди далі
 * не йдуть, порівнює їх hikka.io локально. Перемотка ({seek}) — лише коли користувач натиснув «Пропустити» чи смужку міток.
 *
 * Раніше тут були обхід стилю Hikka Features (0.5.2–0.5.4; вони виправили в 3.1.22) і замір панелі Moon,
 * щоб рамка ставала вищою (0.5.4–0.5.5) — замір розгойдував розкладку Moon у вузькому блоці (панель блимала), прибрано.
 */
import { AMBIENT_MSG, AMBIENT_REQ } from '@/src/watch/types';
import { FP_RATE, frameHash } from '@/src/watch/fp-hash';

export const FRAME_NAME = 'hikka-plus';
const PARENT = 'https://hikka.io';
const W = 32;
const H = 18;

export default defineContentScript({
  matches: ['https://ashdi.vip/vod/*', 'https://moonanime.art/iframe/*', 'https://moonanime.net/iframe/*', 'https://fenixplay.xyz/*'],
  allFrames: true,
  runAt: 'document_idle',
  main() {
    if (window.parent === window || window.name !== FRAME_NAME) return;
    ambient();
  },
});

function ambient() {
  let on = false;
  let scan = false;
  let fpBuf = '';
  let fpStep = -1;
  let fpTimer = 0;
  let failed = false;
  let timer = 0;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const send = (m: Record<string, unknown>) => window.parent.postMessage({ type: AMBIENT_MSG, ...m }, PARENT);

  const pick = (): HTMLVideoElement | null => {
    let best: HTMLVideoElement | null = null;
    let area = 0;
    for (const v of document.querySelectorAll('video')) {
      if (v.readyState < 2 || !v.videoWidth) continue;
      const r = v.getBoundingClientRect();
      if (r.width * r.height > area) {
        best = v;
        area = r.width * r.height;
      }
    }
    return best;
  };

  let lastT = -1;
  let logged = false;
  const sample = () => {
    if ((!on && !scan) || failed || !ctx) return;
    const v = pick();
    if (!v) return;
    // На паузі кадр не змінюється — не шлемо те саме.
    if (v.paused && v.currentTime === lastT) return;
    lastT = v.currentTime;
    const step = Math.round(v.currentTime * FP_RATE);
    const wantFp = scan && step !== fpStep;
    if (!wantFp && (!on || document.hidden)) return;
    try {
      ctx.drawImage(v, 0, 0, W, H);
      const px = ctx.getImageData(0, 0, W, H).data;
      if (wantFp) {
        fpStep = step;
        fpBuf += `${step},${frameHash(px, W, H)};`;
        if (!fpTimer) fpTimer = window.setTimeout(flushFp, 1000);
      }
      if (!on || document.hidden) return;
      // Рядком RGB (по символу на байт): у Firefox об'єкти між скриптом фрейму і сторінкою йдуть через Xray-обгортки,
      // ArrayBuffer там не впізнається — рядок проходить без проблем.
      let rgb = '';
      for (let i = 0; i < px.length; i += 4) rgb += String.fromCharCode(px[i]!, px[i + 1]!, px[i + 2]!);
      send({ w: W, h: H, rgb });
      if (!logged) {
        logged = true;
        console.info('[Hikka Plus] підсвітка: кадри йдуть');
      }
    } catch {
      // SecurityError: відео з іншого сервера без CORS — кадр нам недоступний.
      failed = true;
      console.info('[Hikka Plus] підсвітка: кадр цього плеєра браузер читати не дає (відео без CORS)');
      send({ off: true });
      stop();
    }
  };
  const flushFp = () => {
    fpTimer = 0;
    if (!fpBuf) return;
    const v = pick();
    send({ fp: fpBuf, d: v?.duration && Number.isFinite(v.duration) ? v.duration : 0 });
    fpBuf = '';
  };
  const start = () => {
    if (timer || failed) return;
    timer = window.setInterval(sample, 100);
    sample();
  };
  const stop = () => {
    clearInterval(timer);
    timer = 0;
  };

  // Moon: вигляд панелі — налаштування самого плеєра (data-ma-bar на <html>, напр. "below" — «Під кадром»).
  // Лише ЧИТАЄМО й кажемо hikka.io: при «Під кадром» рамка вища (інакше смуги, а на малій висоті у Firefox панель блимає).
  // Шлемо при зміні і у відповідь на КОЖЕН запит hikka.io (там обробник міг перестворитися й скинути стан).
  const moon = location.hostname.startsWith('moonanime.');
  let lastBar: string | null | undefined;
  const reportBar = (force = false) => {
    if (!moon) return;
    const bar = document.documentElement.getAttribute('data-ma-bar');
    if (!force && bar === lastBar) return;
    if (bar !== lastBar) console.info(`[Hikka Plus] Moon: вигляд панелі «${bar ?? 'типовий'}»`);
    lastBar = bar;
    send({ bar: bar ?? '' });
  };
  if (moon) new MutationObserver(() => reportBar()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-ma-bar'] });

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || e.origin !== PARENT) return;
    const d = e.data as { type?: unknown; on?: unknown; scan?: unknown; seek?: unknown } | null;
    if (!d || d.type !== AMBIENT_REQ) return;
    if (typeof d.seek === 'number') {
      const v = pick();
      if (v && Number.isFinite(d.seek) && d.seek >= 0) v.currentTime = Math.min(d.seek, (v.duration || Infinity) - 0.5);
      return;
    }
    on = d.on === true;
    scan = d.scan === true;
    reportBar(true);
    if (on || scan) start();
    else stop();
  });
  // hikka.io міг надіслати запит раніше, ніж ми запустилися, — просимо повторити.
  send({ ready: true });
  reportBar(true);

}
