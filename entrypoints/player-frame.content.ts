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
 * Раніше тут були обхід стилю Hikka Features (0.5.2–0.5.4; вони виправили в 3.1.22) і замір панелі Moon,
 * щоб рамка ставала вищою (0.5.4–0.5.5) — замір розгойдував розкладку Moon у вузькому блоці (панель блимала), прибрано.
 */
import { AMBIENT_MSG, AMBIENT_REQ } from '@/src/watch/types';

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
    if (!on || failed || !ctx || document.hidden) return;
    const v = pick();
    if (!v) return;
    // На паузі кадр не змінюється — не шлемо те саме.
    if (v.paused && v.currentTime === lastT) return;
    lastT = v.currentTime;
    try {
      ctx.drawImage(v, 0, 0, W, H);
      const px = ctx.getImageData(0, 0, W, H).data;
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
  const start = () => {
    if (timer || failed) return;
    timer = window.setInterval(sample, 100);
    sample();
  };
  const stop = () => {
    clearInterval(timer);
    timer = 0;
  };

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || e.origin !== PARENT) return;
    const d = e.data as { type?: unknown; on?: unknown } | null;
    if (!d || d.type !== AMBIENT_REQ) return;
    on = d.on === true;
    if (on) start();
    else stop();
  });
  // hikka.io міг надіслати запит раніше, ніж ми запустилися, — просимо повторити.
  send({ ready: true });

  // Moon: вигляд панелі — налаштування самого плеєра (data-ma-bar на <html>, напр. "below" — «Під кадром»).
  // Лише ЧИТАЄМО й кажемо hikka.io: при «Під кадром» рамка вища (інакше смуги, а на малій висоті у Firefox панель блимає).
  if (location.hostname.startsWith('moonanime.')) {
    let lastBar: string | null | undefined;
    const report = () => {
      const bar = document.documentElement.getAttribute('data-ma-bar');
      if (bar === lastBar) return;
      lastBar = bar;
      send({ bar: bar ?? '' });
    };
    report();
    new MutationObserver(report).observe(document.documentElement, { attributes: true, attributeFilter: ['data-ma-bar'] });
  }
}
