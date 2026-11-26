/*
 * Свій блок у віконці картки Hikka (hover card), MK 2026-11-26 12:40–12:54: на постері місця немає — тут
 *  - аніме: «Переглянуто X з Y (усього Z)», «▶ N нових», «Серія N · через X дн.», «Продовжити — серія N, мм:сс»;
 *  - манґа/ранобе: «Прочитано X з Y (усього Z)», «▶ N нових розділів», «Продовжити — Розділ N» (у читалку, #read=…).
 *
 * DOM Hikka: віконце — [data-slot=hover-card-content] (Base UI, flex-col gap-4); відкритий тригер —
 * [data-slot=hover-card-trigger][data-popup-open] (картка з посиланням на тайтл). У віконці теж бувають тригери
 * (персонажі) зі своїм віконцем — беремо те, чий заголовок h3 є в тексті картки.
 * Вставляємо лише свій <hikka-plus-pop> (Shadow DOM, без Preact) останнім у віконце; кольори — змінні Hikka.
 * Дані — ті самі, що й для плашок (знімок кешу Hikka через міст, розклад, «вийшло на джерелі»), плюс своє збережене:
 * позиція плеєра (src/watch/watch-store.ts) і прогрес читалки (src/core/store.ts). Новий запит — лише коли аніме
 * переглянуто повністю: продовження з Hikka (src/watch/sequel.ts, кеш 3 дні) → «Наступний сезон».
 * «Продовжити» — SPA-перехід Hikka через міст (NAV_EVENT), без перезавантаження сторінки.
 */
import { NAV_EVENT } from '../core/bridge';
import type { ReadKind } from '../core/page';
import { getProgress, getSettings, posText, type Progress } from '../core/store';
import { getWatchSaved, type WatchSaved } from '../watch/watch-store';
import { getSequel, sequelTitle, type Sequel } from '../watch/sequel';
import { titleLangItem, type TitleLang } from '../core/title-lang';
import { dubNew, dubsItem, type DubMap } from '../watch/dub-alerts';
import type { CardsPrefs } from './prefs';
import type { ReleasedMap } from './released';
import type { Schedule } from './schedule';

export const POP_TAG = 'hikka-plus-pop';

/** Те, що знає cards.ts про тайтл зі знімка Hikka (див. CardRow): released/total, watched — переглянуто/прочитано в списку (-1 — невідомо). */
type PopInfo = { released: number; total: number; status: string; watched: number; ws: string };

export type PopState = {
  prefs: CardsPrefs;
  info: Map<string, PopInfo>;
  schedule: Schedule;
  released: ReleasedMap;
};

/** Куди малювати свій блок: тайтл і елемент Hikka, останнім дитям якого стає наш хост. */
export type Spot = { kind: 'anime' | ReadKind; slug: string; content: HTMLElement };
type Target = Spot;

const CSS = `
:host { all: initial; display: block; font: 400 14px/20px var(--font-sans, ui-sans-serif, system-ui, sans-serif); color: var(--popover-foreground, #fff); }
.box {
  display: flex; flex-direction: column; gap: 10px; padding: 12px;
  border: 1px solid var(--border, rgb(255 255 255 / 0.1)); border-radius: calc(var(--radius, 8px) + 2px);
  background: color-mix(in srgb, var(--secondary, #222) 35%, transparent);
  animation: in 0.18s ease-out both;
}
@keyframes in { from { opacity: 0; transform: translateY(4px); } }
@media (prefers-reduced-motion: reduce) { .box { animation: none; } }
.head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.prog { font-weight: 600; font-size: 14px; }
.prog b { color: var(--primary-foreground, oklch(72% 0.18 343)); font-weight: 700; }
.tot { color: var(--muted-foreground, rgb(255 255 255 / 0.6)); font-size: 12px; white-space: nowrap; }
.bar { position: relative; height: 4px; border-radius: 4px; overflow: hidden; background: color-mix(in srgb, var(--muted-foreground, #888) 22%, transparent); }
.bar i { position: absolute; inset: 0 auto 0 0; border-radius: inherit; background: var(--primary-foreground, oklch(72% 0.18 343)); }
.bar s { position: absolute; top: 0; bottom: 0; border-radius: inherit; background: color-mix(in srgb, var(--primary-foreground, oklch(72% 0.18 343)) 35%, transparent); text-decoration: none; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 7px; border: 1px solid transparent;
  font-size: 12px; font-weight: 600; line-height: 18px; white-space: nowrap;
  background: var(--secondary, #222); color: var(--secondary-foreground, #ddd);
}
.chip.new { background: var(--primary, oklch(30% 0.05 343)); color: var(--primary-foreground, oklch(72% 0.18 343)); border-color: var(--primary-border, transparent); }
svg { width: 14px; height: 14px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.go {
  all: unset; box-sizing: border-box; cursor: pointer;
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 12px; border-radius: var(--radius, 8px);
  border: 1px solid var(--primary-border, transparent);
  background: var(--primary, oklch(30% 0.05 343)); color: var(--primary-foreground, oklch(72% 0.18 343));
  font-weight: 600; font-size: 14px; line-height: 20px;
  transition: filter 0.15s, transform 0.15s;
}
.go:hover { filter: brightness(1.15); }
.go:active { transform: scale(0.98); }
.go:focus-visible { outline: 2px solid var(--ring, #fff); outline-offset: 2px; }
.go .t { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.go .t > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.go small { font-size: 11px; line-height: 14px; font-weight: 500; opacity: 0.75; }
.go svg { width: 16px; height: 16px; }
.go .s { flex: none; font-weight: 500; font-size: 12px; opacity: 0.75; font-variant-numeric: tabular-nums; }
`;

const ICON = {
  play: ['M6 4l14 8-14 8z'],
  cal: ['M8 2v4', 'M16 2v4', 'M3 10h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'],
  book: ['M12 7v14', 'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z'],
};
function icon(paths: string[]) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** «12:34» / «1:02:03». */
function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** «через 3 дн.», «через 5 год», «через 20 хв». */
function inText(sec: number): string {
  if (sec >= 86400) return `через ${Math.max(1, Math.round(sec / 86400))} дн.`;
  if (sec >= 3600) return `через ${Math.round(sec / 3600)} год`;
  return `через ${Math.max(1, Math.round(sec / 60))} хв`;
}
function plural(n: number, one: string, few: string, many: string) {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return one;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return few;
  return many;
}

/** Віконце картки, що зараз відкрите, і тайтл його картки. */
function findTarget(): Target | null {
  const contents = [...document.querySelectorAll<HTMLElement>('[data-slot="hover-card-content"]')].filter((c) => !c.hasAttribute('data-ending-style'));
  if (!contents.length) return null;
  for (const tr of document.querySelectorAll<HTMLElement>('[data-slot="hover-card-trigger"][data-popup-open]')) {
    const a = tr.matches('a[href]') ? (tr as HTMLAnchorElement) : tr.querySelector<HTMLAnchorElement>('a[href^="/anime/"], a[href^="/manga/"], a[href^="/novel/"]');
    const m = a && /^\/(anime|manga|novel)\/([^/?#]+)\/?$/.exec(a.getAttribute('href') ?? '');
    if (!m) continue;
    const text = tr.textContent ?? '';
    const content =
      contents.length === 1
        ? contents[0]!
        : contents.find((c) => {
            const h = c.querySelector('h3')?.textContent?.trim();
            return !!h && text.includes(h);
          });
    if (content) return { kind: m[1] as Target['kind'], slug: m[2]!, content };
  }
  return null;
}

type Line = {
  progress?: { done: number; out: number; total: number; verb: string };
  chips: { cls: string; text: string; icon?: string[]; title?: string }[];
  go?: { verb: string; text: string; sub?: string; path: string; scroll?: boolean };
};

/** Переглянуто серій (своє збережене або список Hikka). */
function animeDone(slug: string, st: PopState, saved: WatchSaved | null) {
  const eps = saved?.eps ?? {};
  const localMax = Math.max(0, ...Object.entries(eps).filter(([, e]) => e.w).map(([k]) => Number(k)));
  return Math.max(localMax, st.info.get(slug)?.watched ?? -1, 0);
}

/** Аніме переглянуто повністю — тоді шукаємо наступний сезон. */
function animeAllDone(slug: string, st: PopState, saved: WatchSaved | null) {
  const inf = st.info.get(slug);
  const done = animeDone(slug, st, saved);
  return inf?.ws === 'completed' || (!!inf && inf.total > 0 && done >= inf.total);
}

function animeLine(slug: string, st: PopState, saved: WatchSaved | null, sequel: Sequel | null | undefined, lang: TitleLang): Line | null {
  const inf = st.info.get(slug);
  const eps = saved?.eps ?? {};
  const done = animeDone(slug, st, saved);
  const out = inf && inf.released > 0 ? inf.released : 0;
  const total = inf && inf.total > 0 ? inf.total : 0;
  const line: Line = { chips: [] };
  const inList = !!inf?.ws;
  if (done > 0 || inList) line.progress = { done, out, total, verb: 'Переглянуто' };
  if (out > done && (inf?.ws === 'watching' || (done > 0 && inf?.ws !== 'dropped' && inf?.ws !== 'completed'))) {
    const n = out - done;
    line.chips.push({ cls: 'new', text: `▶ ${n} ${plural(n, 'нова', 'нові', 'нових')}` });
  }
  const next = st.schedule[slug];
  const now = Date.now() / 1000;
  if (st.prefs.next && next && next[1] > now && inf?.ws !== 'dropped') {
    const date = new Date(next[1] * 1000).toLocaleString('uk-UA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    line.chips.push({ cls: '', text: `Серія ${next[0]} · ${inText(next[1] - now)}`, icon: ICON.cal, title: date });
  }
  // «Продовжити» — як вирішить сам плеєр при заході (watch-block: недодивлена збережена серія → з її місця, інакше — перша після переглянутої).
  const cur = saved?.ep;
  const limit = out || total || Infinity;
  if (cur && !eps[cur]?.w) {
    line.go = { verb: 'Продовжити', text: `Серія ${cur}`, sub: saved?.t && saved.t > 5 ? clock(saved.t) : undefined, path: `/anime/${slug}`, scroll: true };
  } else if (done > 0 && done < limit) {
    line.go = { verb: 'Дивитися далі', text: `Серія ${done + 1}`, path: `/anime/${slug}`, scroll: true };
  } else if (sequel && animeAllDone(slug, st, saved)) {
    line.go = { verb: sequel.soon ? 'Наступний сезон · анонс' : 'Наступний сезон', text: sequelTitle(sequel, lang), path: `/anime/${sequel.slug}`, scroll: !sequel.soon };
  }
  return line.progress || line.chips.length || line.go ? line : null;
}

function bookLine(kind: ReadKind, slug: string, st: PopState, prog: Progress | null, reader: boolean): Line | null {
  const key = `${kind}:${slug}`;
  const inf = st.info.get(key);
  const read = Object.entries(prog?.chapters ?? {})
    .filter(([, c]) => c.read)
    .map(([k]) => Math.floor(Number(k)))
    .filter(Number.isFinite);
  const done = Math.max(0, inf?.watched ?? -1, ...read);
  const out = st.released[key]?.n ?? 0;
  const total = inf && inf.total > 0 ? inf.total : 0;
  const line: Line = { chips: [] };
  if (done > 0 || inf?.ws) line.progress = { done, out, total, verb: 'Прочитано' };
  if (out > done && (inf?.ws === 'reading' || (done > 0 && inf?.ws !== 'dropped' && inf?.ws !== 'completed'))) {
    const n = out - done;
    line.chips.push({ cls: 'new', text: `▶ ${n} ${plural(n, 'новий розділ', 'нові розділи', 'нових розділів')}` });
  }
  const last = prog?.last;
  if (reader && last) {
    const c = prog?.chapters[last.key];
    const hash = '#read=' + encodeURIComponent(`${last.sourceId}:${last.chapterId}`);
    line.go = { verb: 'Продовжити', text: last.label, sub: c && !c.read && c.pos > 0.02 ? posText(c, true) : undefined, path: `/${kind}/${slug}${hash}` };
  }
  return line.progress || line.chips.length || line.go ? line : null;
}

function draw(root: ShadowRoot, line: Line, book: boolean) {
  const style = el('style');
  style.textContent = CSS;
  const box = el('div', 'box');
  const p = line.progress;
  if (p) {
    const head = el('div', 'head');
    const prog = el('span', 'prog', `${p.verb} `);
    prog.append(el('b', undefined, String(p.done)));
    const of = p.out || p.total;
    if (of) prog.append(` з ${of}`);
    head.append(prog);
    if (p.total && p.out && p.total !== p.out) head.append(el('span', 'tot', `усього ${p.total}`));
    box.append(head);
    const all = p.total || p.out;
    if (all) {
      const bar = el('div', 'bar');
      if (p.out && p.total && p.out < p.total) {
        const s = el('s');
        s.style.left = '0';
        s.style.width = `${Math.min(100, (p.out / p.total) * 100)}%`;
        bar.append(s);
      }
      const i = el('i');
      i.style.width = `${Math.min(100, (p.done / all) * 100)}%`;
      bar.append(i);
      box.append(bar);
    }
  }
  if (line.chips.length) {
    const chips = el('div', 'chips');
    for (const c of line.chips) {
      const ch = el('span', `chip ${c.cls}`.trim());
      if (c.icon) ch.append(icon(c.icon));
      ch.append(c.text);
      if (c.title) ch.title = c.title;
      chips.append(ch);
    }
    box.append(chips);
  }
  if (line.go) {
    const go = line.go;
    const b = el('button', 'go');
    b.type = 'button';
    const txt = el('span', 't');
    txt.append(el('small', undefined, go.verb), el('span', undefined, go.text));
    b.append(icon(book ? ICON.book : ICON.play), txt);
    if (go.sub) b.append(el('span', 's', go.sub));
    b.title = `${go.verb}: ${go.text}${go.sub ? `, ${go.sub}` : ''}`;
    const stop = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => {
      stop(e);
      navigate(go.path, !!go.scroll);
    });
    box.append(b);
  }
  root.replaceChildren(style, box);
}

/** SPA-перехід Hikka (міст у контексті сторінки, entrypoints/hikka-bridge.ts); аніме — ще й прокрутити до плеєра. */
export function navigate(path: string, toPlayer: boolean) {
  document.dispatchEvent(new CustomEvent(NAV_EVENT, { detail: path }));
  if (!toPlayer) return;
  const t0 = Date.now();
  const tick = () => {
    const w = location.pathname === path.split('#')[0] ? document.querySelector('hikka-plus-watch') : null;
    if (w) return void setTimeout(() => w.scrollIntoView({ block: 'start', behavior: 'smooth' }), 150);
    if (Date.now() - t0 < 8000) setTimeout(tick, 200);
  };
  setTimeout(tick, 200);
}

/**
 * Блок у віконці картки: schedule() — перевірити віконце (з MutationObserver і коли змінились дані: знімок Hikka,
 * розклад, «вийшло»); відкрите — домалювати/оновити свій блок, закрилось — прибрати. dispose() — при вивантаженні.
 */
export function createPopup(getState: () => PopState) {
  return createSpot(getState, { tag: POP_TAG, find: findTarget, on: (st) => st.prefs.pop, progress: true, dubs: false });
}

/**
 * Свій блок поруч із тайтлом Hikka (віконце картки, трекер на головній — src/cards/tracker.ts): find() — де він зараз,
 * on() — чи ввімкнено; progress — своя смужка «Переглянуто X з Y» (у трекері Hikka її вже показує);
 * dubs — «+N в озвучці» (нові серії в команді з src/watch/dub-alerts.ts).
 */
export function createSpot(
  getState: () => PopState,
  o: { tag: string; find: () => Spot | null; on: (st: PopState) => boolean; progress: boolean; dubs: boolean },
) {
  // sequel: undefined — ще не питали, null — немає (або питаємо).
  let cur: {
    key: string;
    host: HTMLElement;
    state: string;
    saved: WatchSaved | null;
    prog: Progress | null;
    reader: boolean;
    sequel?: Sequel | null;
  } | null = null;
  let timer = 0;
  // Мова назв користувача Hikka — для «Наступний сезон».
  let lang: TitleLang = 'title_ua';
  void titleLangItem.getValue().then((v) => (lang = v));
  const unLang = titleLangItem.watch((v) => {
    lang = v ?? 'title_ua';
    schedule();
  });
  // Нові серії в озвучках (лише де o.dubs).
  let dubs: DubMap = {};
  let unDubs = () => {};
  if (o.dubs) {
    void dubsItem.getValue().then((m) => {
      dubs = m;
      schedule();
    });
    unDubs = dubsItem.watch((m) => {
      dubs = m ?? {};
      schedule();
    });
  }

  const run = () => {
    timer = 0;
    const st = getState();
    const t = o.find();
    if (!t || !o.on(st)) {
      if (cur && !cur.host.isConnected) cur = null;
      if (!t && cur) {
        cur.host.remove();
        cur = null;
      }
      return;
    }
    const key = `${t.kind}:${t.slug}`;
    if (!cur || cur.key !== key || !cur.host.isConnected || cur.host.parentElement !== t.content) {
      cur?.host.remove();
      let host = t.content.querySelector<HTMLElement>(`:scope > ${o.tag}`);
      if (!host) {
        host = document.createElement(o.tag);
        host.attachShadow({ mode: 'open' });
        t.content.append(host);
      }
      cur = { key, host, state: '', saved: null, prog: null, reader: false };
      const mine = cur;
      // Своє збережене — асинхронно; поки не прочитали, малюємо з даних Hikka.
      if (t.kind === 'anime') {
        void getWatchSaved(t.slug).then((s) => {
          mine.saved = s;
          if (cur === mine) schedule();
        });
      } else {
        const kind = t.kind;
        void Promise.all([getProgress(kind, t.slug), getSettings()]).then(([p, s]) => {
          mine.prog = p;
          mine.reader = s.enabled;
          if (cur === mine) schedule();
        });
      }
    }
    if (t.kind === 'anime' && cur.sequel === undefined && animeAllDone(t.slug, st, cur.saved)) {
      const mine = cur;
      mine.sequel = null;
      void getSequel(t.slug).then((s) => {
        mine.sequel = s;
        if (cur === mine && s) schedule();
      });
    }
    let line = t.kind === 'anime' ? animeLine(t.slug, st, cur.saved, cur.sequel, lang) : bookLine(t.kind, t.slug, st, cur.prog, cur.reader);
    if (line && !o.progress) delete line.progress;
    const d = o.dubs && t.kind === 'anime' ? dubs[t.slug] : undefined;
    const dn = d ? dubNew(d) : 0;
    if (dn > 0) {
      line ??= { chips: [] };
      line.chips.unshift({ cls: 'new', text: `+${dn} в озвучці`, title: `${d!.tn}: ${dn} ${plural(dn, 'нова серія', 'нові серії', 'нових серій')} з минулого перегляду` });
    }
    if (line && !line.progress && !line.chips.length && !line.go) line = null;
    const state = JSON.stringify(line);
    if (state === cur.state) return;
    cur.state = state;
    const root = cur.host.shadowRoot!;
    if (!line) {
      cur.host.hidden = true;
      root.replaceChildren();
      return;
    }
    cur.host.hidden = false;
    draw(root, line, t.kind !== 'anime');
  };
  // Не requestAnimationFrame: у фоновій вкладці він не спрацьовує, і прапорець «уже заплановано» зависав би.
  const schedule = () => {
    if (!timer) timer = window.setTimeout(run, 16);
  };
  const dispose = () => {
    if (timer) clearTimeout(timer);
    unLang();
    unDubs();
    cur?.host.remove();
    cur = null;
    for (const h of document.querySelectorAll(o.tag)) h.remove();
  };
  return { schedule, dispose };
}
