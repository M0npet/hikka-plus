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
 * Сканер міток (0.5.22, plan-marks-v2 §3): у ДРУГОМУ нашому iframe (name="hikka-plus-scan", прозорий, під плеєром)
 * за запитом {sweep: {from, to, rate}} перемотуємо на from, граємо на rate× (16 — максимум і в Firefox, і в Chromium;
 * звук вище 4× браузери глушать самі — mute плеєра не чіпаємо, він зберігся б і в основному плеєрі), раз на 20 мс
 * рахуємо відбиток кожного кроку 0,5 с і шлемо пачками ({fp, d}), на to — пауза і {swept: 'ok'|'stall'|'off'}.
 * Перевірено вживу (2026-11-23): Ashdi і Moon тримають 16×, буфер встигає (~20 с відео за секунду), кадри щоразу нові.
 *
 * Раніше тут були обхід стилю Hikka Features (0.5.2–0.5.4; вони виправили в 3.1.22) і замір панелі Moon,
 * щоб рамка ставала вищою (0.5.4–0.5.5) — замір розгойдував розкладку Moon у вузькому блоці (панель блимала), прибрано.
 */
import { AMBIENT_MSG, AMBIENT_REQ } from '@/src/watch/types';
import { FP_RATE, frameHash } from '@/src/watch/fp-hash';

export const FRAME_NAME = 'hikka-plus';
export const SCAN_NAME = 'hikka-plus-scan';
const PARENT = 'https://hikka.io';
const W = 32;
const H = 18;

export default defineContentScript({
  matches: ['https://ashdi.vip/vod/*', 'https://moonanime.art/iframe/*', 'https://moonanime.net/iframe/*', 'https://fenixplay.xyz/*'],
  allFrames: true,
  runAt: 'document_idle',
  main() {
    if (window.parent === window) return;
    if (window.name === FRAME_NAME || window.name === SCAN_NAME) fixPlyrSpeed();
    if (window.name === FRAME_NAME) {
      ambient();
      // Плеєр міг уже стартувати з 16× зі сховища (слід сканера 0.5.22) — перші 15 с повертаємо 1×.
      const t0 = Date.now();
      const fix = window.setInterval(() => {
        for (const v of document.querySelectorAll('video')) if (v.playbackRate > 4) v.playbackRate = 1;
        if (Date.now() - t0 > 15000) clearInterval(fix);
      }, 500);
    }
    else if (window.name === SCAN_NAME) sweeper();
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

/** Відео плеєра: найдовше (реклама коротка), з відомою тривалістю. */
function mainVideo(): HTMLVideoElement | null {
  let best: HTMLVideoElement | null = null;
  for (const v of document.querySelectorAll('video'))
    if (v.readyState >= 1 && Number.isFinite(v.duration) && v.duration > 0 && (!best || v.duration > best.duration)) best = v;
  return best;
}

function sweeper() {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const send = (m: Record<string, unknown>) => window.parent.postMessage({ type: AMBIENT_MSG, ...m }, PARENT);
  let job: { from: number; to: number; rate: number } | null = null;
  let v: HTMLVideoElement | null = null;
  let timer = 0;
  let buf = '';
  let lastStep = -1;
  let flushAt = 0;
  let moved = 0; // коли востаннє рухалися (для «застряг»)
  let lastT = -1;
  let kicks = 0;
  let kickAt = 0;
  let started = 0;
  let frames = 0;
  let snap: StoreSnap | null = null;
  let restoreAt = 0;

  const flush = () => {
    if (!buf) return;
    send({ fp: buf, d: v?.duration ?? 0 });
    buf = '';
  };
  const finish = (how: 'ok' | 'stall' | 'off') => {
    clearInterval(timer);
    timer = 0;
    flush();
    try {
      v?.pause();
    } catch {
      /* немає */
    }
    restoreStore(snap);
    if (job) {
      console.info(`[Hikka Plus] сканер міток: ${how}, ${Math.round(job.from)}–${Math.round(job.to)} с, кадрів ${frames}`);
      send({ swept: how });
    }
    job = null;
  };
  // Плеєр (або реклама) міг поставити 1× / паузу — повертаємо, поки сканер працює. Звук з'являється лише на ≤ 4×,
  // тож швидкість ставимо синхронно на кожен play.
  document.addEventListener(
    'play',
    (e) => {
      if (job && e.target instanceof HTMLVideoElement) e.target.playbackRate = job.rate;
    },
    true,
  );
  // Щойно плеєр записав швидкість/звук — повернути (setTimeout: Plyr пише в обробнику тієї самої події).
  for (const ev of ['ratechange', 'volumechange'])
    document.addEventListener(ev, () => job && setTimeout(() => restoreStore(snap), 50), true);
  window.addEventListener('pagehide', () => restoreStore(snap));
  const tick = () => {
    if (!job) return;
    const now = Date.now();
    if (now - restoreAt > 2000) {
      restoreAt = now;
      restoreStore(snap);
    }
    if (!v || !v.isConnected) {
      v = mainVideo();
      if (!v) {
        if (now - started > 45000) finish('stall');
        return;
      }
      const d = v.duration;
      const from = job.from < 0 ? Math.max(0, d + job.from) : Math.min(job.from, d);
      job = { ...job, from, to: job.to < 0 ? Math.max(0, d + job.to) : Math.min(job.to || d, d) };
      v.currentTime = from;
      moved = now;
    }
    // Кінець — до «штовхання»: play() на закінченому відео почав би його з нуля.
    if (v.ended || (v.currentTime >= job.to - 0.4 && v.currentTime >= job.from)) return finish('ok');
    if (v.playbackRate !== job.rate) v.playbackRate = job.rate;
    if (v.paused && now - kickAt > 1000) {
      kickAt = now;
      if (++kicks > 60) return finish('stall');
      void v.play().catch((err: unknown) => {
        // Без жесту користувача зі звуком не можна — тоді беззвучно (у цьому фреймі; плеєр уже на 16×).
        if ((err as Error)?.name === 'NotAllowedError' && v) {
          v.muted = true;
          void v.play().catch(() => {});
        }
      });
    }
    const t = v.currentTime;
    if (t !== lastT) {
      lastT = t;
      moved = now;
    } else if (now - moved > 20000) return finish('stall');
    if (t + 0.25 < job.from) return; // ще перемотуємо
    const step = Math.round(t * FP_RATE);
    if (step !== lastStep && ctx && v.readyState >= 2) {
      lastStep = step;
      try {
        ctx.drawImage(v, 0, 0, W, H);
        buf += `${step},${frameHash(ctx.getImageData(0, 0, W, H).data, W, H)};`;
        frames++;
      } catch {
        send({ off: true });
        return finish('off');
      }
    }
    if (now - flushAt > 1000) {
      flushAt = now;
      flush();
    }
  };

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || e.origin !== PARENT) return;
    const d = e.data as { type?: unknown; sweep?: unknown } | null;
    if (!d || d.type !== AMBIENT_REQ || !('sweep' in d)) return;
    const sw = d.sweep as { from?: unknown; to?: unknown; rate?: unknown } | null;
    if (!sw) return finish('ok');
    const from = Number(sw.from);
    const to = Number(sw.to);
    const rate = Math.min(16, Math.max(1, Number(sw.rate) || 16));
    if (!Number.isFinite(from) || !Number.isFinite(to) || job) return;
    job = { from, to, rate };
    snap = snapStore();
    v = null;
    lastStep = -1;
    frames = 0;
    kicks = 0;
    started = moved = Date.now();
    timer = window.setInterval(tick, 20);
  });
  send({ ready: true });
}

/*
 * Плеєри пам'ятають налаштування в localStorage свого сайту — спільному для нашого плеєра й сканера (перевірено 2026-11-23):
 *  - Moon (Plyr): "plyr" {speed, muted, volume, quality} — після скану наступний Moon відкривався на 16× без звуку (баг 0.5.22);
 *  - Moon: "ma:progress:v1" {items: {<id серії>: {t, d, at, e}}} — позиція серії;
 *  - Ashdi (PlayerJS): "pljsplayfrom_videoplayer<id>…" — позиція серії.
 * Сканер знімає їх перед сканом і повертає як було (під час скану теж — щоб плеєр, відкритий у цей час, не підхопив 16×).
 */
const PLYR = 'plyr';
const MOON_PROGRESS = 'ma:progress:v1';
const pageId = () => location.pathname.split('/').filter(Boolean).pop() ?? '';
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

type StoreSnap = { plyr: Record<string, unknown> | null; moon: unknown; ashdi: Map<string, string> };

function snapStore(): StoreSnap | null {
  try {
    const id = pageId();
    const ashdi = new Map<string, string>();
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('pljsplayfrom_') && id && k.includes(id)) ashdi.set(k, localStorage.getItem(k) ?? '');
    }
    const items = readJson(MOON_PROGRESS)?.items as Record<string, unknown> | undefined;
    return { plyr: readJson(PLYR), moon: items?.[id], ashdi };
  } catch {
    return null;
  }
}

function restoreStore(snap: StoreSnap | null) {
  if (!snap) return;
  try {
    const id = pageId();
    const cur = readJson(PLYR);
    if (cur) {
      const speed = typeof snap.plyr?.speed === 'number' && snap.plyr.speed <= 4 ? snap.plyr.speed : 1;
      const muted = typeof snap.plyr?.muted === 'boolean' ? snap.plyr.muted : false;
      if (cur.speed !== speed || cur.muted !== muted) localStorage.setItem(PLYR, JSON.stringify({ ...cur, speed, muted }));
    }
    const mp = readJson(MOON_PROGRESS);
    const items = mp?.items as Record<string, unknown> | undefined;
    if (mp && items && id && JSON.stringify(items[id]) !== JSON.stringify(snap.moon)) {
      if (snap.moon === undefined) delete items[id];
      else items[id] = snap.moon;
      localStorage.setItem(MOON_PROGRESS, JSON.stringify(mp));
    }
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('pljsplayfrom_') || !id || !k.includes(id)) continue;
      const was = snap.ashdi.get(k);
      if (was === undefined) localStorage.removeItem(k);
      else if (localStorage.getItem(k) !== was) localStorage.setItem(k, was);
    }
  } catch {
    /* сховище недоступне */
  }
}
