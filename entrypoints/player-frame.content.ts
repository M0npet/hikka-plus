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
 * Поріг зарахування серії (MK 2026-11-26): hikka.io шле {count: сек} — малюємо свою риску на смужці прокрутки
 * Moon (Plyr, .plyr__progress), Ashdi і Fenix (.fenix-progress-bar) — і на переглянутій серії; не шле, коли поріг = мітка ендингу самого плеєра (MK 17:13).
 * Там же — відрізки OP/ED з AniSkip, коли в плеєра своїх міток немає ({segs}, MK 17:15). Лише додаємо свій елемент hp-count (pointer-events: none), решту плеєра не чіпаємо.
 * Ashdi (PlayerJS): класів немає, смужку шукаємо за будовою (`ashdiBar`, перевірено 2026-11-26 на ashdi.vip/vod/104218).
 *
 * Навантаження (0.6.0, MK 22:37): кадр — 5 разів на секунду (було 10) і без willReadFrequently — інакше браузер
 * тримає canvas у пам'яті процесора й щоразу копіює з відеокарти весь кадр 1080p; так масштабує відеокарта,
 * а читаємо лише 32×18. Плеєр поза екраном — hikka.io просить {on:false}. Відбитки кадрів і сканер міток прибрано.
 *
 * Раніше тут були обхід стилю Hikka Features (0.5.2–0.5.4; вони виправили в 3.1.22) і замір панелі Moon,
 * щоб рамка ставала вищою (0.5.4–0.5.5) — замір розгойдував розкладку Moon у вузькому блоці (панель блимала), прибрано.
 */
import { AMBIENT_MSG, AMBIENT_REQ } from '@/src/watch/types';

const FRAME_NAME = 'hikka-plus';
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
    idleCursor();
    if (location.hostname === 'fenixplay.xyz') fenixMarks();
    countMark();
    hotkeys();
    activity();
    holdControls();
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
    if (!d || d.type !== AMBIENT_REQ || 'count' in d || 'hold' in d) return; // {count} — для countMark, {hold} — для holdControls
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
    const d = e.data as { type?: unknown; hold?: unknown } | null;
    if (d?.type !== AMBIENT_REQ || d.hold) return;
    last = '';
    later();
  });
}

/**
 * Курсор над плеєром (MK 2026-11-26: «мышка не пропадает»): плеєри ховають його лише у СВОЄМУ
 * повному екрані, а наш «На весь екран» — це повний екран рамки на hikka.io, плеєр про нього не знає. Тож самі:
 * відео грає і мишу не рухали IDLE_MS — курсор у фреймі ховаємо; рух/клік/клавіша — повертаємо. Лише стиль курсора.
 */
function idleCursor() {
  // Moon (Plyr): у самого плеєра курсор ховається разом із панеллю, але лише в його повному екрані
  // (plyr.css: `.plyr:fullscreen.plyr--hide-controls{cursor:none}`). Беремо його ж стан «панель сховано»
  // (`plyr--hide-controls`) і поза повним екраном — курсор зникає рівно тоді, коли зникає панель плеєра.
  if (location.hostname.startsWith('moonanime.')) {
    const plyr = document.createElement('style');
    plyr.textContent = '.plyr.plyr--hide-controls, .plyr.plyr--hide-controls * { cursor: none !important; }';
    (document.head ?? document.documentElement).append(plyr);
    return;
  }
  // Fenix ховає курсор сам і поза повним екраном (`.fenix-root.inactive{cursor:none}`, перевірено 2026-11-26) — не заважаємо.
  if (location.hostname === 'fenixplay.xyz') return;
  // Ashdi (PlayerJS): поза повним екраном курсор не ховає (перевірено 2026-11-26: серія грає, мишу не рухали —
  // cursor лишається default), окремого стану «панель сховано» в CSS немає — тому наш таймер.
  const IDLE_MS = 2500;
  const css = document.createElement('style');
  css.textContent = 'html, html * { cursor: none !important; }';
  let timer = 0;
  let inside = false;
  const playing = () => [...document.querySelectorAll('video')].some((v) => !v.paused && !v.ended && v.readyState > 2);
  const show = () => css.remove();
  const arm = () => {
    clearTimeout(timer);
    timer = window.setTimeout(function check() {
      if (!inside) return;
      // На паузі курсор не ховаємо, але й не здаємося: перевіримо знову (відео могли пустити клавішею).
      if (playing()) (document.head ?? document.documentElement).append(css);
      else timer = window.setTimeout(check, IDLE_MS);
    }, IDLE_MS);
  };
  const wake = () => {
    inside = true;
    show();
    arm();
  };
  for (const ev of ['pointermove', 'pointerdown', 'wheel', 'keydown'] as const) document.addEventListener(ev, wake, { passive: true, capture: true });
  document.documentElement.addEventListener('mouseleave', () => {
    inside = false;
    clearTimeout(timer);
    show();
  });
}

/**
 * Ashdi (PlayerJS, <pjsdiv> без класів і id): доріжка смужки прокрутки — блок з однаковою шириною дітей
 * (фон 4 px, завантажене, переглянуте), усі `bottom: 0px`, висота ≤ 8 px, ширина ≥ 30 % вікна.
 */
function ashdiBar(): HTMLElement | null {
  for (const e of document.querySelectorAll<HTMLElement>('pjsdiv')) {
    const kids = [...e.children].filter((c): c is HTMLElement => c instanceof HTMLElement && !c.classList.contains('hp-count'));
    if (kids.length < 2) continue;
    const a = kids[0]!;
    if (a.style.bottom !== '0px' || !(parseFloat(a.style.height) <= 8)) continue;
    const w = e.getBoundingClientRect().width;
    if (w < innerWidth * 0.3 || Math.abs(a.getBoundingClientRect().width - w) > 2) continue;
    if (!kids.every((c) => c.style.bottom === '0px')) continue;
    return e;
  }
  return null;
}

/**
 * Гарячі клавіші (MK 2026-11-26): лише коли фокус у НАШОМУ плеєрі (на hikka.io клавіш не чіпаємо).
 * S — пропустити опенінг/ендинг, N — наступна серія. За фізичною клавішею (e.code) — працює й в українській розкладці.
 * Самі нічого не робимо — кажемо hikka.io ({hotkey}), там вирішують, чи є що пропускати і чи є наступна серія.
 */
function hotkeys() {
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const key = e.code === 'KeyS' ? 'skip' : e.code === 'KeyN' ? 'next' : null;
      if (!key) return;
      e.preventDefault();
      e.stopPropagation();
      window.parent.postMessage({ type: AMBIENT_MSG, hotkey: key }, PARENT);
    },
    true,
  );
}

/**
 * Рух миші / дотик у плеєрі → hikka.io ({active: 1}; вийшли за межі — {active: 0}). Там показують свою панель кнопок
 * поверх плеєра (MK 2026-11-26) і ховають її, коли миша стоїть, — як панель самого плеєра. Не частіше ніж раз на 300 мс.
 */
function activity() {
  let last = 0;
  const ping = (e: Event) => {
    if (!e.isTrusted) return; // наш власний {hold} (holdControls) — не справжній рух у плеєрі
    const now = Date.now();
    if (now - last < 300) return;
    last = now;
    window.parent.postMessage({ type: AMBIENT_MSG, active: 1 }, PARENT);
  };
  for (const ev of ['pointermove', 'pointerdown', 'wheel'] as const) document.addEventListener(ev, ping, { passive: true, capture: true });
  document.documentElement.addEventListener('mouseleave', () => {
    last = 0;
    window.parent.postMessage({ type: AMBIENT_MSG, active: 0 }, PARENT);
  });
}

/**
 * Панель плеєра не ховати, поки миша на НАШИХ кнопках поверх плеєра (MK 2026-11-26 15:26: «когда наводишься на наш
 * интерфейс, интерфейс плеера прячется»). Для плеєра миша тоді «вийшла» з фрейму. hikka.io раз на секунду шле {hold} —
 * імітуємо рух миші по центру плеєра (pointermove + mousemove, спливають до контейнера): Plyr (Moon) показує панель на
 * mousemove контейнера, Fenix і PlayerJS (Ashdi) — так само на русі миші. Лише подія, стан плеєра не чіпаємо.
 */
function holdControls() {
  const fire = () => {
    const x = innerWidth / 2;
    const y = innerHeight / 2;
    const el = document.elementFromPoint(x, y) ?? document.querySelector('video') ?? document.body;
    if (!el) return;
    const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: window };
    el.dispatchEvent(new PointerEvent('pointerover', init));
    el.dispatchEvent(new MouseEvent('mouseover', init));
    el.dispatchEvent(new PointerEvent('pointermove', init));
    el.dispatchEvent(new MouseEvent('mousemove', init));
  };
  // Fenix ховає ВЕСЬ інтерфейс разом із затемненням одразу на pointerleave свого .fenix-root (hideUiNow у player.js,
  // перевірено 2026-11-26) — коли миша йде з кадру на наш шар, наш {hold} повертав його вже після цього → мигало
  // затемнення (MK 16:31–16:48). Тому вихід з кадру Fenix не відпускаємо одразу: чекаємо 300 мс — прийшов {hold}
  // (миша на нашій панелі) → Fenix про вихід так і не дізнається; ні → передаємо йому pointerleave самі (ховає як завжди).
  const fenixRoot = () => (location.hostname === 'fenixplay.xyz' ? document.querySelector<HTMLElement>('.fenix-root') : null);
  let leaveT = 0;
  const release = () => {
    leaveT = 0;
    fenixRoot()?.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
  };
  document.addEventListener(
    'pointerleave',
    (e) => {
      // Лише справжній вихід миші за межі кадру (relatedTarget у сусідньому документі = null), не наш власний release.
      if (!e.isTrusted || e.relatedTarget || (e.pointerType && e.pointerType !== 'mouse') || e.target !== fenixRoot()) return;
      e.stopImmediatePropagation();
      clearTimeout(leaveT);
      leaveT = window.setTimeout(release, 300);
    },
    true,
  );
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || e.origin !== PARENT) return;
    const d = e.data as { type?: unknown; hold?: unknown } | null;
    if (d?.type !== AMBIENT_REQ || !d.hold) return;
    clearTimeout(leaveT); // миша на нашому шарі — для плеєра вона «не виходила»
    leaveT = 0;
    fire();
  });
  // Миша повернулася в плеєр — відкладений вихід більше не потрібен.
  document.addEventListener('pointermove', (e) => e.isTrusted && leaveT && (clearTimeout(leaveT), (leaveT = 0)), { passive: true, capture: true });
}

/**
 * На смужці прокрутки самого плеєра (Moon, Ashdi, Fenix): риска порогу зарахування серії і відрізки опенінгу/ендингу,
 * яких плеєр сам не показує (AniSkip) — MK 2026-11-26 17:13–17:15. Свої мітки плеєра hikka.io сюди не шле.
 */
function countMark() {
  const moon = location.hostname.startsWith('moonanime.');
  const fenix = location.hostname === 'fenixplay.xyz';
  const ashdi = location.hostname === 'ashdi.vip';
  if (!moon && !fenix && !ashdi) return;
  let at: number | null = null;
  let segs: [string, number, number][] = [];
  let els: HTMLElement[] = [];
  let bar: HTMLElement | null = null;
  let timer = 0;
  const duration = () => {
    let d = 0;
    for (const v of document.querySelectorAll('video')) if (Number.isFinite(v.duration) && v.duration > d) d = v.duration;
    return d;
  };
  const remove = () => {
    for (const e of els) e.remove();
    els = [];
  };
  // Висота й положення доріжки: Ashdi — 4 px біля низу блоку нульової висоти; Moon — 5 px по центру; Fenix — уся смужка.
  const track = ashdi ? 'bottom:-4px;height:4px' : moon ? 'top:50%;height:5px;transform:translateY(-50%)' : 'top:0;bottom:0';
  const make = (css: string, title: string) => {
    const e = document.createElement('span');
    e.className = 'hp-count';
    e.title = title;
    e.style.cssText = 'position:absolute;pointer-events:none;border-radius:2px;' + css;
    return e;
  };
  const place = () => {
    const d = duration();
    const items = [
      ...segs.filter(([, s, e]) => e > s && s < d).map(([k, s, e]) => ({ k, s, e })),
      ...(at != null && at < d ? [{ k: 'count', s: at, e: at }] : []),
    ];
    if (!(d > 0) || !items.length) return remove();
    if (!bar?.isConnected) bar = ashdi ? ashdiBar() : document.querySelector<HTMLElement>(moon ? '.plyr__progress' : '.fenix-progress-bar');
    if (!bar || getComputedStyle(bar).position === 'static') return remove(); // некуди прив'язати — не чіпаємо розкладку плеєра
    if (els.length !== items.length || els.some((e, i) => e.dataset.k !== items[i]!.k)) {
      remove();
      els = items.map(({ k }) => {
        const e =
          k === 'count'
            ? make(
                'width:3px;background:#ff86c4;box-shadow:0 0 0 1px rgba(0,0,0,.45);z-index:3;' +
                  (ashdi ? 'bottom:-4px;height:12px;transform:translateX(-50%)' : `top:50%;transform:translate(-50%,-50%);height:${moon ? '12px' : 'calc(100% + 6px)'};min-height:8px`),
                'Тут серія зарахується',
              )
            : make(`${track};background:rgba(255,134,196,.55);z-index:2`, k === 'op' ? 'Опенінг (AniSkip)' : 'Ендинг (AniSkip)');
        e.dataset.k = k;
        return e;
      });
    }
    items.forEach(({ s, e }, i) => {
      const el = els[i]!;
      if (el.parentElement !== bar) bar!.append(el);
      const left = `${((s / d) * 100).toFixed(3)}%`;
      if (el.style.left !== left) el.style.left = left;
      if (e > s) {
        const w = `${(((Math.min(e, d) - s) / d) * 100).toFixed(3)}%`;
        if (el.style.width !== w) el.style.width = w;
      }
    });
  };
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || e.origin !== PARENT) return;
    const d = e.data as { type?: unknown; count?: unknown; segs?: unknown } | null;
    if (!d || d.type !== AMBIENT_REQ || !('count' in d)) return;
    at = typeof d.count === 'number' && d.count > 0 ? d.count : null;
    segs = Array.isArray(d.segs)
      ? d.segs.filter((x): x is [string, number, number] => Array.isArray(x) && (x[0] === 'op' || x[0] === 'ed') && typeof x[1] === 'number' && typeof x[2] === 'number')
      : [];
    place();
    // Плеєр перемальовує смужку (зміна серії/озвучки, тривалість з'являється не одразу) — раз на секунду перевіряємо.
    if (at == null && !segs.length) {
      clearInterval(timer);
      timer = 0;
    } else if (!timer) timer = window.setInterval(place, 1000);
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
