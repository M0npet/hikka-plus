/*
 * Українські постери замість оригінальних — аніме, манґа й ранобе (MK 2026-11-25: «везде», за замовчуванням увімкнено;
 * 02:25 — «і для ранобе, і для аніме», вимикач — загальний, вкладка «Hikka»).
 *
 * Аніме: Mikai (публічний API, дозволили 2026-11-24) має окреме поле `images.uaPoster` — україномовні постери (команда
 * uaposters тощо). Шукаємо точно за slug Hikka, пакетом: `GET /anime/batch?source=hikka&ids=…` (до 100 за запит) для всіх
 * карток аніме, видимих на сторінці, — без відкриття тайтлу. Немає постера — пам'ятаємо «немає» 3 дні.
 *
 * Манґа й ранобе:
 * Звідки: обкладинка тайтлу, ДО ЯКОГО ВЖЕ Є ПРИВ'ЯЗКА в блоці «Розділи» (автопідбір або вручну), — з першого з джерел
 * Zenko → Honey Manga → DGManga → manga.in.ua (у них обкладинки українські; UAManga й Animesvit дають оригінали —
 * розвідка `claude/research-ua-posters.md`). Шукати за назвою для кожної картки каталогу НЕ можна: десятки запитів
 * і хибні збіги. Тож постер з'являється після першого відкриття тайтлу.
 *
 * Запит — один `getTitle` на джерелі при відкритті тайтлу, далі раз на 14 днів (той самий запит, що й читалка,
 * через background, `credentials: 'omit'`). Сама картинка вантажиться звичайним <img> з сайту джерела (без Referer).
 *
 * Показ (src/cards/cards.ts): свій <hikka-plus-cover> зі Shadow DOM одразу після блоку з картинкою Hikka — поверх постера,
 * але під значками Hikka; pointer-events: none. Якщо постер уже підмінило інше розширення (картинка не з hikka.io) — не чіпаємо.
 */
import { storage } from '#imports';
import type { ReadKind } from '../core/page';
import { getJson } from '../core/net';
import { getBinding } from '../core/store';
import { getSource, sourcesFor } from '../sources/registry';

/** `<manga|novel>:<slug>` → обкладинка. */
export type Cover = {
  /** Адреса картинки ('' — у Mikai немає українського постера, перевірено `at`). */
  u: string;
  /** Більша картинка для постера на сторінці тайтлу (Mikai). */
  b?: string;
  /** Автор / команда постера (Mikai) — для підказки. */
  a?: string;
  /** Джерело й id тайтлу на ньому. */
  s: string;
  id: string;
  /** Коли брали. */
  at: number;
  /** 1 — для цього тайтлу користувач обрав оригінальний постер Hikka. */
  o?: 1;
  /** Джерело постера, яке користувач обрав сам (меню кнопки «UA», MK 2026-11-25); інакше — за COVER_SOURCES. */
  p?: string;
};
export type CoverMap = Record<string, Cover>;

export const coversItem = storage.defineItem<CoverMap>('local:hp:covers', { fallback: {} });
/** Порядок = пріоритет. */
export const COVER_SOURCES: Record<ReadKind, readonly string[]> = {
  manga: ['zenko', 'honeymanga', 'dgmanga', 'mangainua'],
  // Ранобе (2026-11-25): на Баці частина обкладинок українські (решта — оригінал), у Honey/DGManga — переважно українські.
  novel: ['baka', 'honeymanga', 'dgmanga'],
};
const NONE_TTL_MS = 3 * 86400_000;
const MIKAI = 'https://api.mikai.me/public/v1';
const TTL_MS = 14 * 86400_000;
const MAX = 1000;

export type CoverKind = ReadKind | 'anime';
export const coverKey = (kind: CoverKind, slug: string) => `${kind}:${slug}`;

let queue: Promise<unknown> = Promise.resolve();
function patch(fn: (m: CoverMap) => CoverMap) {
  queue = queue
    .then(async () => {
      let m = fn({ ...(await coversItem.getValue()) });
      const keys = Object.keys(m);
      if (keys.length > MAX) {
        const keep = keys.sort((a, b) => m[b]!.at - m[a]!.at).slice(0, MAX);
        m = Object.fromEntries(keep.map((k) => [k, m[k]!]));
      }
      await coversItem.setValue(m);
    })
    .catch(() => {});
  return queue;
}

/** Zenko віддає мініатюру 180 px — для постера на сторінці тайтлу беремо 480. */
function sized(u: string): string {
  return /^https:\/\/storage\.zenko\.online\//.test(u) ? u.replace(/([?&]width=)\d+/, '$1480') : u;
}

/** Після відкриття тайтлу (і ручної прив'язки): запам'ятати українську обкладинку з прив'язаного джерела. */
export async function noteCover(kind: ReadKind, slug: string, force = false): Promise<boolean> {
  const key = coverKey(kind, slug);
  const b = await getBinding(kind, slug);
  const enabled = new Set(sourcesFor(kind).map((s) => s.id));
  const cur = (await coversItem.getValue())[key];
  // Обране користувачем джерело — якщо прив'язка до нього ще є; інакше — перше з COVER_SOURCES.
  const chosen = cur?.p && enabled.has(cur.p) && b.links[cur.p] ? cur.p : undefined;
  const pick = chosen ?? COVER_SOURCES[kind].find((id) => enabled.has(id) && b.links[id]);
  if (!pick) {
    // Прив'язок більше немає — і постера немає (вибір «оригінал» без постера не потрібен).
    if (cur) await patch((m) => (delete m[key], m));
    return false;
  }
  const link = b.links[pick]!;
  if (!force && cur && cur.s === pick && cur.id === link.remoteId && Date.now() - cur.at < TTL_MS) return true;
  const t = await getSource(pick)
    ?.getTitle(link.remoteId)
    .catch(() => null);
  const u = t?.cover && /^https:\/\//.test(t.cover) ? sized(t.cover) : null;
  if (!u) return false;
  await patch((m) => {
    const p = m[key]?.p;
    return { ...m, [key]: { u, s: pick, id: link.remoteId, at: Date.now(), ...(m[key]?.o ? { o: 1 as const } : {}), ...(p ? { p } : {}) } };
  });
  return true;
}

/** Варіанти для меню кнопки «UA»: аніме — Mikai; манґа/ранобе — усі ввімкнені джерела з прив'язкою. */
export async function coverChoices(kind: CoverKind, slug: string): Promise<{ id: string; name: string }[]> {
  if (kind === 'anime') return [{ id: 'mikai', name: 'Mikai (uaposters)' }];
  const b = await getBinding(kind, slug);
  return sourcesFor(kind)
    .filter((x) => b.links[x.id])
    .map((x) => ({ id: x.id, name: x.name }));
}

/**
 * Вибір у меню кнопки «UA»: 'orig' — оригінал Hikka; інакше — постер з цього джерела (запит getTitle одразу).
 * false — на джерелі немає обкладинки (вибір не змінюється).
 */
export async function setCoverSource(kind: CoverKind, slug: string, id: string): Promise<boolean> {
  if (id === 'orig') return (await setCoverOriginal(kind, slug, true), true);
  if (kind === 'anime') return (await setCoverOriginal(kind, slug, false), true);
  const key = coverKey(kind, slug);
  const prev = (await coversItem.getValue())[key];
  await patch((m) => {
    const c = m[key];
    if (!c) return m;
    const { o: _o, ...rest } = c;
    return { ...m, [key]: { ...rest, p: id } };
  });
  if (await noteCover(kind, slug, true)) return true;
  // Обкладинки немає — повернути, як було.
  if (prev) await patch((m) => ({ ...m, [key]: prev }));
  return false;
}

type MikaiImg = { big?: { webp?: string; jpg?: string }; medium?: { webp?: string; jpg?: string } };
type MikaiAnime = {
  ids?: { mikai?: number };
  images?: { uaPoster?: { author?: string | null; team?: { name?: string } | null; images?: MikaiImg } | null };
} | null;

const pending = new Set<string>();
/** Mikai не відповів — ці slug не просимо до `failUntil` (раніше просили знову кожні 2 с, поки сторінка відкрита). */
const failed = new Map<string, number>();
const FAIL_MS = 10 * 60_000;
let flushTimer = 0;
let lastFlush = 0;
let inflight = false;

/** Аніме-картки на сторінці: дізнатися в Mikai українські постери тих, яких ще не знаємо (пакетом, не частіше ніж раз на 2 с). */
export function wantAnimeCovers(slugs: string[], known: CoverMap) {
  const now = Date.now();
  for (const slug of slugs) {
    const c = known[coverKey('anime', slug)];
    if (c && now - c.at < (c.u ? TTL_MS : NONE_TTL_MS)) continue;
    if ((failed.get(slug) ?? 0) > now) continue;
    pending.add(slug);
  }
  if (!pending.size || flushTimer || inflight) return;
  flushTimer = window.setTimeout(flushAnime, Math.max(300, 2000 - (now - lastFlush)));
}

async function flushAnime() {
  flushTimer = 0;
  if (inflight || !pending.size) return;
  const batch = [...pending].slice(0, 100);
  for (const s of batch) pending.delete(s);
  inflight = true;
  lastFlush = Date.now();
  try {
    const res = await getJson<{ result?: Record<string, MikaiAnime> }>(
      `${MIKAI}/anime/batch?source=hikka&ids=${batch.map(encodeURIComponent).join(',')}`,
    );
    const at = Date.now();
    await patch((m) => {
      for (const slug of batch) {
        const key = coverKey('anime', slug);
        const a = res.result?.[slug];
        const up = a?.images?.uaPoster;
        const pic = (x?: { webp?: string; jpg?: string }) => x?.webp ?? x?.jpg ?? '';
        const u = pic(up?.images?.medium) || pic(up?.images?.big);
        const keepO = m[key]?.o ? { o: 1 as const } : {};
        m[key] = u
          ? { u, b: pic(up?.images?.big) || u, a: up?.author || up?.team?.name || undefined, s: 'mikai', id: String(a?.ids?.mikai ?? ''), at, ...keepO }
          : { u: '', s: 'mikai', id: '', at, ...keepO };
      }
      return m;
    });
  } catch {
    // Mikai не відповів — ці тайтли не просимо 10 хв.
    const until = Date.now() + FAIL_MS;
    for (const s of batch) failed.set(s, until);
  } finally {
    inflight = false;
    if (pending.size) flushTimer = window.setTimeout(flushAnime, 2000);
  }
}

/** Оригінальний постер Hikka чи український (кнопка «UA» на постері, src/cards/cards.ts). */
export function setCoverOriginal(kind: CoverKind, slug: string, original: boolean) {
  const key = coverKey(kind, slug);
  return patch((m) => {
    const c = m[key];
    if (!c) return m;
    const { o: _o, ...rest } = c;
    return { ...m, [key]: original ? { ...rest, o: 1 } : rest };
  });
}

export const COVER_SOURCE_NAMES: Record<string, string> = {
  mikai: 'Mikai',
  baka: 'Бака',
  zenko: 'Zenko',
  honeymanga: 'Honey Manga',
  dgmanga: 'DGManga',
  mangainua: 'Manga.in.ua',
};

/** Назва джерела постера для підказки (будь-яке джерело — користувач міг обрати й не з COVER_SOURCES). */
export const coverSourceName = (id: string) => COVER_SOURCE_NAMES[id] ?? getSource(id)?.name ?? id;
