/*
 * Плашки на картках аніме Hikka, як на Mikai (MK 2026-11-23, 18:26): «▶ N нових» і «N серія через X дн.».
 *
 *  - «▶ N нових» = episodes_released − переглянуті, лише для тайтлів зі статусом «Дивлюсь». Дані — з кешу самої Hikka
 *    (міст entrypoints/hikka-bridge.ts → CARDS_EVENT): каталог і календар віддають запис того, хто зайшов, «Мої списки» —
 *    лише власний список. Жодного запиту до API.
 *  - «N серія через X дн.» — розклад Hikka (src/cards/schedule.ts, раз на 3 год).
 *
 * DOM Hikka не змінюємо: у картку додаємо лише свій елемент <hikka-plus-badges> зі своїм Shadow DOM
 * (без Preact — на сторінці бувають сотні карток), pointer-events: none — клік іде в картку.
 * Постер: div[data-slot="aspect-ratio"] > a[href^="/anime/"] — плашки внизу зліва (справа вгорі — значок статусу Hikka).
 * Таблиця «Мої списки»: постер там крихітний — плашки в рядок після назви.
 */
import type { ContentScriptContext } from '#imports';
import { CARDS_EVENT, CARDS_REQ, type CardRow } from '../core/bridge';
import { cardsItem, DEFAULT_CARDS, type CardsPrefs } from './prefs';
import { getSchedule, type Schedule } from './schedule';

const TAG = 'hikka-plus-badges';

const CSS = `
:host { all: initial; pointer-events: none; font-family: inherit; }
:host([data-kind="poster"]) {
  position: absolute; left: 8px; right: 8px; bottom: 8px; z-index: 2;
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
export function newText(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return `${n} нова`;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return `${n} нові`;
  return `${n} нових`;
}

/** «через 3 дн.», «через 5 год», «через 20 хв». */
export function inText(sec: number): string {
  if (sec >= 86400) return `через ${Math.max(1, Math.round(sec / 86400))} дн.`;
  if (sec >= 3600) return `через ${Math.round(sec / 3600)} год`;
  return `через ${Math.max(1, Math.round(sec / 60))} хв`;
}

export function badgesFor(info: Info | undefined, next: [number, number] | undefined, prefs: CardsPrefs, now = Date.now() / 1000): { cls: string; text: string }[] {
  const out: { cls: string; text: string }[] = [];
  if (info && info.ws === 'watching' && info.watched >= 0 && info.released > info.watched)
    out.push({ cls: 'new', text: `▶ ${newText(info.released - info.watched)}` });
  if (prefs.next && next && next[1] > now && info?.ws !== 'dropped' && info?.ws !== 'completed')
    out.push({ cls: 'next', text: `${next[0]} серія ${inText(next[1] - now)}` });
  return out;
}

const slugOf = (a: HTMLAnchorElement) => /^\/anime\/([^/?#]+)/.exec(a.getAttribute('href') ?? '')?.[1] ?? '';

export function initCards(ctx: ContentScriptContext) {
  let prefs: CardsPrefs = DEFAULT_CARDS;
  const info = new Map<string, Info>();
  let schedule: Schedule = {};
  let scheduled = false;

  const render = () => {
    scheduled = false;
    const seen = new Set<Element>();
    if (prefs.on) {
      for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href^="/anime/"]')) {
        const slug = slugOf(a);
        if (!slug) continue;
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
        const list = badgesFor(info.get(slug), schedule[slug], prefs);
        let host = [...box.children].find((c) => c.tagName === TAG.toUpperCase()) as HTMLElement | undefined;
        if (!list.length) continue; // зайвий host приберемо нижче
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
  };
  // Hikka міняє DOM часто (таймери, коментарі, плеєр поруч) — перебираємо картки не частіше ніж раз на 250 мс
  // (0.6.0, було на кожному кадрі зі змінами). Плашки вимкнені й на сторінці їх немає — нічого не робимо.
  const schedule_ = () => {
    if (scheduled) return;
    if (!prefs.on && !document.querySelector(TAG)) return;
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
    if (prefs.on) refreshSchedule();
    schedule_();
  });
  ctx.onInvalidated(
    cardsItem.watch((p) => {
      prefs = { ...DEFAULT_CARDS, ...p };
      if (prefs.on) refreshSchedule();
      schedule_();
    }),
  );

  const obs = new MutationObserver(schedule_);
  obs.observe(document.body, { childList: true, subtree: true });
  ctx.onInvalidated(() => {
    obs.disconnect();
    for (const h of document.querySelectorAll(TAG)) h.remove();
  });
  // Міст з'являється не одразу; «через X» оновлюємо раз на хвилину, розклад — коли застаріє.
  ask();
  ctx.setTimeout(ask, 1500);
  ctx.setInterval(() => {
    if (!prefs.on) return;
    refreshSchedule();
    schedule_();
  }, 60_000);
}
