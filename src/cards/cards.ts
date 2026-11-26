/*
 * Плашки на картках аніме Hikka, як на Mikai (MK 2026-11-23, 18:26): «▶ N нових» і «N серія через X дн.».
 *
 *  - «▶ N нових» = episodes_released − переглянуті, лише для тайтлів зі статусом «Дивлюсь». Дані — з кешу самої Hikka
 *    (міст entrypoints/hikka-bridge.ts → CARDS_EVENT): каталог і календар віддають запис того, хто зайшов, «Мої списки» —
 *    лише власний список. Жодного запиту до API.
 *  - «N серія через X дн.» — розклад Hikka (src/cards/schedule.ts, раз на 3 год). З 2026-11-26 (MK) на постері її немає —
 *    переїхала у віконце картки (src/cards/popup.ts); лишилась у рядку таблиці «Мої списки».
 *
 * DOM Hikka не змінюємо: у картку додаємо лише свій елемент <hikka-plus-badges> зі своїм Shadow DOM
 * (без Preact — на сторінці бувають сотні карток), pointer-events: none — клік іде в картку.
 * Постер: div[data-slot="aspect-ratio"] > a[href^="/anime/"] — плашки внизу зліва (справа вгорі — значок статусу Hikka).
 * Таблиця «Мої списки»: постер там крихітний — плашки в рядок після назви.
 *
 * Манґа й ранобе (0.6.1): «▶ N нових розділів» = останній розділ на прив'язаному джерелі (src/cards/released.ts)
 * − прочитано в Hikka, лише статус «Читаю». Прочитане — з того самого кешу Hikka (поле `read`, список читання, `readGet`).
 *
 * Українські постери аніме, манґи й ранобе (src/cards/covers.ts): свій <hikka-plus-cover> одразу після блоку з картинкою Hikka
 * в div[data-slot="aspect-ratio"] — картки, таблиці, «Історія» й великий постер на сторінці тайтлу.
 */
import type { ContentScriptContext } from '#imports';
import { CARDS_EVENT, CARDS_REQ, type CardRow } from '../core/bridge';
import { RATE_LIMIT_TEXT } from '../core/net';
import { coverChoices, coverSourceName, coversItem, setCoverSource, wantAnimeCovers, type CoverKind, type CoverMap } from './covers';
import { cardsItem, DEFAULT_CARDS, type CardsPrefs } from './prefs';
import { refreshReleased, releasedItem, type ReleasedMap } from './released';
import { getSchedule, type Schedule } from './schedule';
import { createPopup, POP_TAG } from './popup';
import { createTracker, TRACKER_TAG } from './tracker';

const TAG = 'hikka-plus-badges';
const COVER_TAG = 'hikka-plus-cover';
// Кнопка «UA» на самому постері (MK 2026-11-25: «значок что постер меняный», «будет кнопкой», 03:29 «лучше сделать и
// справа снизу»): справа внизу (справа вгорі — статус Hikka, зліва внизу — наші плашки), іконка + «UA»; український
// постер ↔ оригінал Hikka для тайтлу (Cover.o). Показано український — колір як у плашки «нових» (--primary Hikka),
// оригінал — темне скло. На мініатюрах (< MIN_POSTER) кнопки немає — container query, без замірів.
const COVER_CSS = `
:host { all: initial; position: absolute; inset: 0; display: block; pointer-events: none; container-type: inline-size; }
img { display: block; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity 0.2s ease-in-out; }
img.on { opacity: 1; }
.ua {
  all: unset; pointer-events: auto; cursor: pointer; box-sizing: border-box;
  position: absolute; right: 8px; bottom: 8px; z-index: 3;
  display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 7px 0 6px;
  border-radius: 7px; border: 1px solid var(--primary-border, transparent);
  font: 600 12px/1 var(--font-sans, ui-sans-serif, system-ui, sans-serif); letter-spacing: 0.03em;
  background: var(--primary, oklch(30% 0.05 343)); color: var(--primary-foreground, oklch(72% 0.18 343));
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.35);
  opacity: 0; transition: opacity 0.2s ease-in-out, filter 0.15s, transform 0.15s;
}
.ua svg { width: 14px; height: 14px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
img.on ~ .ua, .ua.off { opacity: 1; }
.ua:hover { filter: brightness(1.2); }
.ua:active { transform: scale(0.95); }
.ua:focus-visible { outline: 2px solid var(--ring, #fff); outline-offset: 2px; }
.ua.off { background: rgb(0 0 0 / 0.6); color: rgb(255 255 255 / 0.9); border-color: rgb(255 255 255 / 0.18); }
.big { height: 30px; padding: 0 10px 0 8px; font-size: 13px; right: 10px; bottom: 10px; }
.big svg { width: 16px; height: 16px; }
.menu {
  pointer-events: auto; position: absolute; right: 8px; bottom: 38px; z-index: 4; box-sizing: border-box;
  min-width: 150px; max-width: calc(100% - 16px); max-height: calc(100% - 50px); overflow: auto;
  padding: 4px; border-radius: 9px; border: 1px solid var(--border, rgb(255 255 255 / 0.12));
  background: var(--popover, rgb(15 15 18 / 0.96)); color: var(--popover-foreground, #fff);
  box-shadow: 0 6px 20px rgb(0 0 0 / 0.5);
  font: 500 13px/18px var(--font-sans, ui-sans-serif, system-ui, sans-serif);
}
.big ~ .menu, .menu.big { right: 10px; bottom: 46px; }
.menu .h { padding: 4px 8px 6px; font-size: 11px; font-weight: 600; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.04em; }
.menu button {
  all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 6px 8px; border-radius: 6px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.menu button:hover, .menu button:focus-visible { background: var(--accent, rgb(255 255 255 / 0.08)); }
.menu button[aria-checked="true"] { color: var(--primary-foreground, oklch(72% 0.18 343)); }
.menu button::before { content: ""; flex: none; width: 12px; text-align: center; }
.menu button[aria-checked="true"]::before { content: "✓"; }
.menu .note { padding: 4px 8px; font-size: 12px; opacity: 0.7; white-space: normal; }
@container (max-width: 89px) { .ua, .menu { display: none; } }
`;
/** Іконка «картинка» (як IconImage у src/ui/icons.tsx) — без Preact і без innerHTML. */
const IMAGE_PATHS = ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M9 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'm21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21'];
const imageIcon = () => {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of IMAGE_PATHS) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
};
/** Сторінка тайтлу → ключ обкладинки (`<anime|manga|novel>:<slug>`) для великого постера в #content-left-side. */
const pageCoverKey = () => {
  const m = /^\/(anime|manga|novel)\/([^/?#]+)\/?$/.exec(location.pathname);
  return m ? `${m[1]}:${m[2]}` : null;
};
/** Посилання на тайтл → ключ обкладинки. */
const coverKeyOf = (a: HTMLAnchorElement) => {
  const m = /^\/(anime|manga|novel)\/([^/?#]+)\/?$/.exec(a.getAttribute('href') ?? '');
  return m ? `${m[1]}:${m[2]}` : null;
};
/** Картинку постера вже підмінило інше розширення (не з hikka.io) — не чіпаємо. */
const fromHikka = (img: HTMLImageElement) => {
  const src = img.getAttribute('src');
  if (!src) return true;
  try {
    const h = new URL(src, location.href).hostname;
    return h === 'hikka.io' || h.endsWith('.hikka.io');
  } catch {
    return false;
  }
};
/** Мініатюри (віджет «Історія» у профілі, ~44 px) — той самий aspect-ratio, що й картки; плашки туди не лізуть (MK 2026-11-25). */
const MIN_POSTER = 90;

const CSS = `
:host { all: initial; pointer-events: none; font-family: inherit; }
:host([data-kind="poster"]) {
  /* справа місце під кнопку «UA» постера (≈ 50 px) — довга плашка на неї не залазить */
  position: absolute; left: 8px; right: 58px; bottom: 8px; z-index: 2;
  display: flex; flex-direction: column; align-items: flex-start; gap: 5px;
}
:host([data-kind="inline"]) { display: inline-flex; flex-wrap: wrap; gap: 4px; margin-left: 8px; vertical-align: middle; }
.b {
  box-sizing: border-box; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 3px 8px; border-radius: 7px; border: 1px solid transparent;
  font: 600 13px/18px var(--font-sans, ui-sans-serif, system-ui, sans-serif);
  background: rgb(0 0 0 / 0.72); color: #fff; backdrop-filter: blur(4px);
}
.new { background: var(--primary, oklch(30% 0.05 343)); color: var(--primary-foreground, oklch(72% 0.18 343)); border-color: var(--primary-border, transparent); }
:host([data-kind="inline"]) .next { background: var(--secondary, #222); color: var(--secondary-foreground, #ddd); backdrop-filter: none; }
`;

type Info = { released: number; total: number; status: string; watched: number; ws: string };

/** «1 нова», «2 нові», «5 нових». */
function newText(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return `${n} нова`;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return `${n} нові`;
  return `${n} нових`;
}

/** «1 новий розділ», «2 нові розділи», «5 нових розділів». */
function newChaptersText(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return `${n} новий розділ`;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return `${n} нові розділи`;
  return `${n} нових розділів`;
}

/** «через 3 дн.», «через 5 год», «через 20 хв». */
export function inText(sec: number): string {
  if (sec >= 86400) return `через ${Math.max(1, Math.round(sec / 86400))} дн.`;
  if (sec >= 3600) return `через ${Math.round(sec / 3600)} год`;
  return `через ${Math.max(1, Math.round(sec / 60))} хв`;
}

function badgesFor(info: Info | undefined, next: [number, number] | undefined, prefs: CardsPrefs, now = Date.now() / 1000): { cls: string; text: string }[] {
  const out: { cls: string; text: string }[] = [];
  if (info && info.ws === 'watching' && info.watched >= 0 && info.released > info.watched)
    out.push({ cls: 'new', text: `▶ ${newText(info.released - info.watched)}` });
  if (prefs.next && next && next[1] > now && info?.ws !== 'dropped' && info?.ws !== 'completed')
    out.push({ cls: 'next', text: `${next[0]} серія ${inText(next[1] - now)}` });
  return out;
}

/** Плашка манґи/ранобе: Hikka знає прочитане й статус, розширення — скільки вийшло на джерелі. */
function bookBadgesFor(info: Info | undefined, released: number | undefined): { cls: string; text: string }[] {
  if (!info || info.ws !== 'reading' || info.watched < 0 || !released || released <= info.watched) return [];
  return [{ cls: 'new', text: `▶ ${newChaptersText(released - info.watched)}` }];
}

/** Ключ картки: аніме — slug (як у знімку мосту), манґа/ранобе — `<manga|novel>:<slug>`. */
const keyOf = (a: HTMLAnchorElement): { key: string; book: boolean } | null => {
  const m = /^\/(anime|manga|novel)\/([^/?#]+)\/?$/.exec(a.getAttribute('href') ?? '');
  if (!m) return null;
  return m[1] === 'anime' ? { key: m[2]!, book: false } : { key: `${m[1]}:${m[2]}`, book: true };
};

/**
 * Меню кнопки «UA» (MK 2026-11-25 03:32: «выбор источника постера»): оригінал Hikka або постер з будь-якого джерела,
 * до якого тайтл прив'язаний (вибір — Cover.p / Cover.o, src/cards/covers.ts). Живе в Shadow DOM постера;
 * закривається вибором, кліком повз, Esc. Вибір перемальовує всі картки тайтлу (coversItem.watch).
 */
let closeOpenMenu: (() => void) | null = null;
function toggleCoverMenu(root: ShadowRoot, btn: HTMLButtonElement, kind: CoverKind, slug: string, current: string, big: boolean) {
  const had = root.querySelector('.menu');
  closeOpenMenu?.();
  if (had) return;
  const menu = document.createElement('div');
  menu.className = big ? 'menu big' : 'menu';
  menu.setAttribute('role', 'menu');
  const head = document.createElement('div');
  head.className = 'h';
  head.textContent = 'Постер';
  menu.append(head);
  const swallow = (e: Event) => e.stopPropagation();
  menu.addEventListener('pointerdown', swallow);
  menu.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  const close = () => {
    menu.remove();
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', onKey, true);
    if (closeOpenMenu === close) closeOpenMenu = null;
  };
  const outside = (e: Event) => {
    const path = e.composedPath();
    if (!path.includes(menu) && !path.includes(btn)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    close();
    btn.focus();
  };
  const item = (id: string, name: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitemradio');
    b.setAttribute('aria-checked', String(id === current));
    b.textContent = name;
    b.addEventListener('click', () => {
      if (id === current) return close();
      menu.querySelectorAll('button').forEach((x) => (x.disabled = true));
      void setCoverSource(kind, slug, id).then((ok) => {
        if (ok === true) return close();
        menu.querySelectorAll('button').forEach((x) => (x.disabled = false));
        b.disabled = ok === false; // 429 — можна натиснути ще раз за хвилину
        let note = menu.querySelector('.note');
        if (!note) menu.append((note = Object.assign(document.createElement('div'), { className: 'note' })));
        note.textContent = ok === 'limit' ? `«${name}»: ${RATE_LIMIT_TEXT.toLowerCase()}.` : `На «${name}» немає обкладинки.`;
      });
    });
    return b;
  };
  menu.append(item('orig', 'Оригінал Hikka'));
  root.append(menu);
  btn.setAttribute('aria-expanded', 'true');
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', onKey, true);
  closeOpenMenu = close;
  void coverChoices(kind, slug).then((list) => {
    if (!menu.isConnected) return;
    for (const x of list) menu.append(item(x.id, x.name));
    (menu.querySelector('button[aria-checked="true"]') as HTMLButtonElement | null)?.focus({ preventScroll: true });
  });
}

export function initCards(ctx: ContentScriptContext) {
  let prefs: CardsPrefs = DEFAULT_CARDS;
  const info = new Map<string, Info>();
  let schedule: Schedule = {};
  let released: ReleasedMap = {};
  let covers: CoverMap = {};
  /** Адреси, що не завантажились (мертве посилання джерела), — до перезавантаження сторінки не пробуємо. */
  const badCovers = new Set<string>();
  let scheduled = false;
  const popup = createPopup(() => ({ prefs, info, schedule, released }));
  ctx.onInvalidated(popup.dispose);
  const tracker = createTracker(() => ({ prefs, info, schedule, released }));
  ctx.onInvalidated(tracker.dispose);

  const renderCovers = () => {
    const seen = new Set<Element>();
    if (prefs.ua) {
      const pageKey = pageCoverKey();
      const anime: string[] = [];
      for (const box of document.querySelectorAll<HTMLElement>('[data-slot="aspect-ratio"]')) {
        let key: string | null = null;
        let big = false;
        const a = box.querySelector<HTMLAnchorElement>(':scope > a[href^="/anime/"], :scope > a[href^="/manga/"], :scope > a[href^="/novel/"]');
        if (a) key = coverKeyOf(a);
        else if (pageKey && box.closest('#content-left-side')) {
          key = pageKey;
          big = true;
        }
        if (!key) continue;
        if (key.startsWith('anime:')) anime.push(key.slice(6));
        const c = covers[key];
        const src = c && (big ? (c.b ?? c.u) : c.u);
        if (!c || !src || badCovers.has(src)) continue;
        const img = box.querySelector('img');
        if (!img || !fromHikka(img)) continue;
        let top: Element = img;
        while (top.parentElement && top.parentElement !== box) top = top.parentElement;
        const next = top.nextElementSibling;
        let host = next?.tagName === COVER_TAG.toUpperCase() ? (next as HTMLElement) : undefined;
        if (!host) {
          host = document.createElement(COVER_TAG);
          host.attachShadow({ mode: 'open' });
          top.after(host);
        }
        seen.add(host);
        // Обрано оригінал (c.o) — картинку не малюємо (видно постер Hikka), лишаємо значок, щоб повернути український.
        const orig = !!c.o;
        const label = 'UA';
        const state = `${orig ? 'o' : 'u'}|${src}|${label}`;
        if (host.dataset.s === state) continue;
        host.dataset.s = state;
        const root = host.shadowRoot!;
        const style = document.createElement('style');
        style.textContent = COVER_CSS;
        const from = coverSourceName(c.s);
        const by = c.a ? `${c.a}, ${from}` : from;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `ua${orig ? ' off' : ''}${big ? ' big' : ''}`;
        if (!big) btn.tabIndex = -1; // сотні карток — не засмічуємо Tab; з клавіатури — значок на великому постері тайтлу
        btn.append(imageIcon(), label);
        btn.title = orig ? 'Показано оригінал Hikka — обрати постер' : `Український постер (${by}) — обрати постер`;
        btn.setAttribute('aria-label', btn.title);
        btn.setAttribute('aria-haspopup', 'menu');
        btn.setAttribute('aria-expanded', 'false');
        const [kind, ...rest] = key.split(':');
        const slug = rest.join(':');
        const stop = (e: Event) => {
          // Значок лежить поверх посилання картки — клік не має відкривати тайтл.
          e.preventDefault();
          e.stopPropagation();
        };
        btn.addEventListener('pointerdown', stop);
        btn.addEventListener('click', (e) => {
          stop(e);
          toggleCoverMenu(root, btn, kind as CoverKind, slug, orig ? 'orig' : c.s, big);
        });
        if (orig) {
          root.replaceChildren(style, btn);
          continue;
        }
        const pic = document.createElement('img');
        pic.alt = '';
        pic.decoding = 'async';
        pic.loading = 'lazy'; // картки поза екраном не вантажимо й не декодуємо
        pic.fetchPriority = 'low';
        pic.referrerPolicy = 'no-referrer'; // manga.in.ua: hotlink-захист
        const u = src;
        pic.addEventListener('load', () => pic.classList.add('on'), { once: true });
        pic.addEventListener(
          'error',
          () => {
            badCovers.add(u);
            schedule_();
          },
          { once: true },
        );
        pic.src = u;
        root.replaceChildren(style, pic, btn);
      }
      // Аніме-картки, про які ще не питали Mikai, — одним пакетом.
      if (anime.length) wantAnimeCovers([...new Set(anime)], covers);
    }
    for (const h of document.querySelectorAll(COVER_TAG)) if (!seen.has(h)) h.remove();
  };

  const render = () => {
    scheduled = false;
    const seen = new Set<Element>();
    const reading: string[] = [];
    // Спершу лише читаємо DOM (включно з розмірами), потім пишемо — щоб не перераховувати розкладку на кожній картці.
    type Job = { a: HTMLAnchorElement; box: Element; kind: 'poster' | 'inline'; list: { cls: string; text: string }[] };
    const jobs: Job[] = [];
    if (prefs.on || prefs.read) {
      for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href^="/anime/"], a[href^="/manga/"], a[href^="/novel/"]')) {
        const k = keyOf(a);
        if (!k || (k.book ? !prefs.read : !prefs.on)) continue;
        const parent = a.parentElement;
        let box: Element | null = null;
        let kind: 'poster' | 'inline' = 'poster';
        if (parent?.matches('[data-slot="aspect-ratio"]')) {
          if (a.closest('td')) continue; // таблиця: постер 48 px — плашки біля назви
          box = parent;
        } else if (a.closest('td') && !a.querySelector('img')) {
          box = a.parentElement;
          kind = 'inline';
        }
        if (!box) continue;
        if (kind === 'poster' && (box as HTMLElement).clientWidth < MIN_POSTER) continue;
        const inf = info.get(k.key);
        if (k.book && inf?.ws === 'reading') reading.push(k.key);
        // «через X дн.» — лише в рядку таблиці; на постері — у віконці картки (popup.ts).
        const list = k.book ? bookBadgesFor(inf, released[k.key]?.n) : badgesFor(inf, kind === 'inline' ? schedule[k.key] : undefined, prefs);
        if (list.length) jobs.push({ a, box, kind, list }); // зайвий host приберемо нижче
      }
    }
    // Постери пишуть у DOM — лише після того, як прочитали розміри карток (clientWidth після запису змушує браузер
    // перерахувати розкладку: замір 2026-11-25 — 5,5 мс замість 0,05 мс на прохід каталогу).
    renderCovers();
    if (jobs.length) {
      for (const { a, box, kind, list } of jobs) {
        let host = [...box.children].find((c) => c.tagName === TAG.toUpperCase()) as HTMLElement | undefined;
        if (!host) {
          host = document.createElement(TAG);
          host.attachShadow({ mode: 'open' });
          if (kind === 'inline') a.after(host);
          else box.append(host);
        }
        seen.add(host);
        const key = `${kind}|${list.map((b) => `${b.cls}:${b.text}`).join('|')}`;
        if (host.dataset.key === key) continue;
        host.dataset.key = key;
        host.dataset.kind = kind;
        const root = host.shadowRoot!;
        root.replaceChildren();
        const style = document.createElement('style');
        style.textContent = CSS;
        root.append(style);
        for (const b of list) {
          const el = document.createElement('span');
          el.className = `b ${b.cls}`;
          el.textContent = b.text;
          root.append(el);
        }
      }
    }
    for (const h of document.querySelectorAll(TAG)) if (!seen.has(h)) h.remove();
    popup.schedule();
    tracker.schedule();
    // Видимі тайтли «Читаю» з прив'язкою — перевірити, чи не вийшло нового (не частіше ніж раз на 3 год на тайтл).
    if (reading.length) void refreshReleased([...new Set(reading)]);
  };
  // Hikka міняє DOM часто (таймери, коментарі, плеєр поруч) — перебираємо картки не частіше ніж раз на 250 мс
  // (0.6.0, було на кожному кадрі зі змінами). Плашки вимкнені й на сторінці їх немає — нічого не робимо.
  const schedule_ = () => {
    if (scheduled) return;
    if (!prefs.on && !prefs.read && !prefs.ua && !prefs.pop && !prefs.trk && !document.querySelector(`${TAG}, ${COVER_TAG}, ${POP_TAG}, ${TRACKER_TAG}`)) return;
    scheduled = true;
    window.setTimeout(render, 250);
  };

  const onCards = (e: Event) => {
    const raw = (e as CustomEvent<unknown>).detail;
    if (typeof raw !== 'string') return;
    try {
      for (const r of JSON.parse(raw) as CardRow[]) {
        if (!Array.isArray(r) || typeof r[0] !== 'string') continue;
        const prev = info.get(r[0]);
        info.set(r[0], {
          released: r[1] >= 0 ? r[1] : (prev?.released ?? -1),
          total: r[2],
          status: r[3],
          // Запис у списку з іншого запиту (віджет, інша сторінка) не губимо, якщо в цьому знімку його немає.
          watched: r[4] >= 0 ? r[4] : (prev?.watched ?? -1),
          ws: r[5] || prev?.ws || '',
        });
      }
    } catch {
      return;
    }
    schedule_();
  };
  document.addEventListener(CARDS_EVENT, onCards);
  ctx.onInvalidated(() => document.removeEventListener(CARDS_EVENT, onCards));

  const refreshSchedule = () =>
    void getSchedule().then((m) => {
      schedule = m;
      schedule_();
    });
  const ask = () => document.dispatchEvent(new CustomEvent(CARDS_REQ));

  void cardsItem.getValue().then((p) => {
    prefs = { ...DEFAULT_CARDS, ...p };
    if (prefs.on || prefs.pop || prefs.trk) refreshSchedule();
    schedule_();
  });
  ctx.onInvalidated(
    cardsItem.watch((p) => {
      prefs = { ...DEFAULT_CARDS, ...p };
      if (prefs.on || prefs.pop || prefs.trk) refreshSchedule();
      schedule_();
    }),
  );

  void releasedItem.getValue().then((m) => {
    released = m;
    schedule_();
  });
  ctx.onInvalidated(
    releasedItem.watch((m) => {
      released = m ?? {};
      schedule_();
    }),
  );

  void coversItem.getValue().then((m) => {
    covers = m;
    schedule_();
  });
  ctx.onInvalidated(
    coversItem.watch((m) => {
      covers = m ?? {};
      schedule_();
    }),
  );

  // Свої вставки (<hikka-plus-badges>/<hikka-plus-cover>) не будять перебір знову — інакше кожна вставка постера
  // запускала ще один прохід по всіх картках (MK 2026-11-25 03:34: «обнова с постерами грузит проц»).
  const ours = (n: Node) =>
    n.nodeType === 1 && [TAG, COVER_TAG, POP_TAG, TRACKER_TAG].some((t) => (n as Element).tagName === t.toUpperCase());
  const obs = new MutationObserver((recs) => {
    // Віконце картки з'являється/зникає — свій блок одразу (за 16 мс), не чекаючи 250 мс перебору карток.
    if (prefs.pop) popup.schedule();
    if (prefs.trk) tracker.schedule();
    for (const r of recs) {
      if (![...r.addedNodes, ...r.removedNodes].every(ours)) return schedule_();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
  ctx.onInvalidated(() => {
    obs.disconnect();
    for (const h of document.querySelectorAll(`${TAG}, ${COVER_TAG}`)) h.remove();
  });
  // Міст з'являється не одразу; «через X» оновлюємо раз на хвилину, розклад — коли застаріє.
  ask();
  ctx.setTimeout(ask, 1500);
  ctx.setInterval(() => {
    if (!prefs.on && !prefs.pop && !prefs.trk) return;
    refreshSchedule();
    schedule_();
  }, 60_000);
}
