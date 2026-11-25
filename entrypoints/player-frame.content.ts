/*
 * Лише всередині НАШОГО iframe плеєра (name="hikka-plus", див. PlayerFrame у src/watch/watch-block.tsx).
 *
 * Підсвітка навколо плеєра (MK 2026-11-23, 14:48, як Ambient mode на YouTube): раз на ~0.2 с зменшуємо поточний кадр
 * відео до 32×18 і шлемо пікселі (рядок RGB) на hikka.io — там їх розмивають за рамкою. Лише ЧИТАЄМО кадр, плеєр не чіпаємо.
 * Працює, лише коли hikka.io попросив (вимикач «Підсвітка» в налаштуваннях плеєра). Якщо кадр відео прочитати не можна
 * (чужий сервер без CORS, напр. реклама перед серією в Ashdi) — це відео пропускаємо й кажемо {off}, доки не з'явиться
 * читабельне (раніше вимикались назавжди — через рекламу в Ashdi підсвітки не було взагалі).
 *
 * Для Moon ще кажемо, який вигляд панелі вибрано в самому плеєрі ({bar}) — рамка під «Під кадром» вища.
 *
 * Перемотка ({seek}) — лише коли користувач натиснув «Пропустити» чи смужку міток.
 *
 * Fenix: мітки OP/ED він шле лише сайту AniHub, а на смужці прокрутки малює їх завжди (.fenix-marker-intro/-ending,
 * left/width у % від тривалості; вже з урахуванням вибраної озвучки). Читаємо їх звідти й шлемо {marks} — без запитів,
 * лише MutationObserver на смужці (MK 2026-11-25: «у Fenix правильные таймкоды»).
 *
 * Навантаження (0.6.0, MK 22:37): кадр — 5 разів на секунду (було 10) і без willReadFrequently — інакше браузер
 * тримає canvas у пам'яті процесора й щоразу копіює з відеокарти весь кадр 1080p; так масштабує відеокарта,
 * а читаємо лише 32×18. Плеєр поза екраном — hikka.io просить {on:false}. Відбитки кадрів і сканер міток прибрано.
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
    if (window.parent === window) return;
    if (window.name !== FRAME_NAME) return;
    fixPlyrSpeed();
    ambient();
    if (location.hostname === 'fenixplay.xyz') fenixMarks();
    // Плеєр міг уже стартувати з 16× зі сховища (слід сканера 0.5.22) — перші 15 с повертаємо 1×.
    const t0 = Date.now();
    const fix = window.setInterval(() => {
      for (const v of document.querySelectorAll('video')) if (v.playbackRate > 4) v.playbackRate = 1;
      if (Date.now() - t0 > 15000) clearInterval(fix);
    }, 500);
  },
});

function ambient() {
  let on = false;
  let timer = 0;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const send = (m: Record<string, unknown>) => window.parent.postMessage({ type: AMBIENT_MSG, ...m }, PARENT);

  // Відео, кадр якого браузер читати не дає (чужий сервер без CORS). У Ashdi це реклама перед серією (перевірено
  // 2026-11-25): саме відео серії (blob) читається. Тому пропускаємо лише такі відео, а не вимикаємось назавжди.
  const tainted = new WeakSet<HTMLVideoElement>();
  const pick = (): HTMLVideoElement | null => {
    let best: HTMLVideoElement | null = null;
    let area = 0;
    for (const v of document.querySelectorAll('video')) {
      if (v.readyState < 2 || !v.videoWidth || tainted.has(v)) continue;
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
  // Аніме часто тримає кадр (статика, 12 к/с): ~60 % сусідніх кадрів майже однакові (замір 2026-11-25, Fenix).
  // Після зміни шлемо ще SAME_SEND повторів (hikka.io змішує кадри з прозорістю 0.4 — щоб колір дійшов до кінця),
  // далі однакові не шлемо, але не рідше ніж раз на KEEP_MS (підсвітка пристроїв без кадрів 3 с повертає їх у свій режим).
  const SAME_DIFF = 1; // середня різниця на канал (0–255), нижче — кадр той самий
  const SAME_SEND = 4;
  const KEEP_MS = 1000;
  let ref: Uint8ClampedArray | null = null;
  let same = 0;
  let sentAt = 0;
  const changed = (px: Uint8ClampedArray) => {
    if (ref && ref.length === px.length) {
      let s = 0;
      for (let i = 0; i < px.length; i += 4) s += Math.abs(px[i]! - ref[i]!) + Math.abs(px[i + 1]! - ref[i + 1]!) + Math.abs(px[i + 2]! - ref[i + 2]!);
      if (s / ((px.length / 4) * 3) < SAME_DIFF) return ++same <= SAME_SEND;
    }
    ref = px;
    same = 0;
    return true;
  };
  const sample = () => {
    if (!on || !ctx || document.hidden) return;
    const v = pick();
    if (!v) return;
    // На паузі кадр не змінюється — не шлемо те саме.
    if (v.paused && v.currentTime === lastT) return;
    lastT = v.currentTime;
    try {
      ctx.drawImage(v, 0, 0, W, H);
      const px = ctx.getImageData(0, 0, W, H).data;
      const now = Date.now();
      if (!changed(px) && now - sentAt < KEEP_MS) return;
      sentAt = now;
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
      // SecurityError: відео з іншого сервера без CORS — кадр нам недоступний. Це відео більше не беремо;
      // поки інших немає — підсвітку ховаємо ({off}), з'явиться читабельне (серія після реклами) — кадри підуть знову.
      tainted.add(v);
      ref = null;
      console.info('[Hikka Plus] підсвітка: кадр цього відео браузер читати не дає (без CORS) — пропускаємо його');
      send({ off: true });
    }
  };
  const start = () => {
    if (timer) return;
    ref = null; // після паузи/повторного запиту hikka.io — перший кадр завжди шлемо
    timer = window.setInterval(sample, 200);
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
    const d = e.data as { type?: unknown; on?: unknown; seek?: unknown } | null;
    if (!d || d.type !== AMBIENT_REQ) return;
    if (typeof d.seek === 'number') {
      const v = pick();
      if (v && Number.isFinite(d.seek) && d.seek >= 0) v.currentTime = Math.min(d.seek, (v.duration || Infinity) - 0.5);
      return;
    }
    on = d.on === true;
    reportBar(true);
    if (on) start();
    else stop();
  });
  // hikka.io міг надіслати запит раніше, ніж ми запустилися, — просимо повторити.
  send({ ready: true });
  reportBar(true);

}

/** Мітки OP/ED зі смужки прокрутки Fenix → hikka.io (сек). */
function fenixMarks() {
  let last = '';
  // Тривалість основного відео: найдовше з усіх <video> (реклама VAST коротка).
  const duration = () => {
    let d = 0;
    for (const v of document.querySelectorAll('video')) if (Number.isFinite(v.duration) && v.duration > d) d = v.duration;
    return d;
  };
  const read = () => {
    const d = duration();
    if (!(d > 0)) return;
    const marks: Record<string, { s: number; e: number }> = {};
    for (const [k, cls] of [['op', 'intro'], ['ed', 'ending']] as const) {
      const el = document.querySelector<HTMLElement>(`.fenix-marker-${cls}`);
      const l = parseFloat(el?.style.left ?? '');
      const w = parseFloat(el?.style.width ?? '');
      if (!(l >= 0 && w > 0)) continue;
      marks[k] = { s: Math.round(((l / 100) * d) * 10) / 10, e: Math.round((((l + w) / 100) * d) * 10) / 10 };
    }
    const key = JSON.stringify(marks);
    if (key === last || key === '{}') return;
    last = key;
    window.parent.postMessage({ type: AMBIENT_MSG, marks }, PARENT);
  };
  let t = 0;
  const later = () => {
    if (!t) t = window.setTimeout(() => ((t = 0), read()), 300);
  };
  // Смужка з'являється не одразу — спершу чекаємо її на всьому документі, потім стежимо лише за нею.
  const watchBar = (bar: Element) => {
    new MutationObserver(later).observe(bar, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    read();
  };
  const bar = document.querySelector('.fenix-progress-bar');
  if (bar) watchBar(bar);
  else {
    const mo = new MutationObserver(() => {
      const b = document.querySelector('.fenix-progress-bar');
      if (!b) return;
      mo.disconnect();
      watchBar(b);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }
  // Повтор відповіді на кожен ready-запит hikka.io (обробник там міг перестворитися).
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || e.origin !== PARENT) return;
    if ((e.data as { type?: unknown } | null)?.type !== AMBIENT_REQ) return;
    last = '';
    later();
  });
}

/* Слід сканера міток 0.5.22 (прибрано в 0.6.0): Plyr у Moon міг запам'ятати 16× ("plyr".speed) — повертаємо 1×. */
const PLYR = 'plyr';
const readJson = (k: string): Record<string, unknown> | null => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** Більше 4× у меню Plyr не поставити — це слід сканера (0.5.22): повертаємо 1×. */
function fixPlyrSpeed() {
  try {
    const o = readJson(PLYR);
    if (o && typeof o.speed === 'number' && o.speed > 4) localStorage.setItem(PLYR, JSON.stringify({ ...o, speed: 1 }));
  } catch {
    /* сховище недоступне */
  }
}
