/*
 * Типи серій у сітці й меню серій (MK 2026-11-26 17:53 «как на Микае», 17:58 «брать напрямую оттуда, где берут они»;
 * вимикач WatchPrefs.fillers). Першоджерело — AnimeFillerList (animefillerlist.com; ті самі 4 типи й ті самі відрізки,
 * що в Mikai — звірено 2026-11-26 на One Piece). API немає — HTML:
 *   /shows — список шоу: #ShowList a[href^="/shows/<slug>"] з назвою «English (Romaji)» (~370; кеш 14 днів);
 *   /shows/<slug> — table.EpisodeList tr.<manga_canon|anime_canon|mixed_canon/filler|filler> > td.Number.
 * Тайтл шукаємо СУВОРО: нормалізована назва Hikka (англ. / ромадзі) = назва шоу; фільми/OVA/спешли не беремо
 * (у самому списку AFL їхні посилання бувають переплутані), і серій у шоу не більше, ніж у Hikka + 5.
 * Не знайшли на AFL — запасний варіант: публічний API Mikai (result.episodeTypes, ті самі дані, вони вже зіставили тайтл).
 * robots.txt AFL: Crawl-delay 10 — у нас 1–2 запити на тайтл раз на тиждень (кеш), список шоу — раз на 2 тижні.
 * Канон за манґою — звичайні серії, без позначки. Кеш на тайтл — 7 днів, онгоінг — 1 день (≤ 60 тайтлів). Без React.
 */
import { storage } from '#imports';
import { getJson, getText } from '../core/net';

/** a — канон (аніме), x — змішаний, f — філер. */
export type EpKind = 'a' | 'x' | 'f';
export type EpKinds = Record<number, EpKind>;
type Saved = Record<string, { at: number; k: EpKinds; ongoing?: boolean }>;
type Ranges = { from?: unknown; to?: unknown }[] | undefined;
type Res = { result?: { episodeTypes?: { animeCanon?: Ranges; mixed?: Ranges; filler?: Ranges } | null } };

const TTL_MS = 7 * 24 * 3600_000;
const TTL_ONGOING_MS = 24 * 3600_000;
const MAX_TITLES = 60;
const MAX_EP = 5000;
const item = storage.defineItem<Saved>('local:hp:epTypes', { fallback: {} });
const inflight = new Map<string, Promise<EpKinds>>();

/** Відрізки {from, to} → номер серії: тип. */
export function parseEpisodeTypes(t: NonNullable<NonNullable<Res['result']>['episodeTypes']> | null | undefined): EpKinds {
  const k: EpKinds = {};
  if (!t) return k;
  for (const [kind, list] of [['a', t.animeCanon], ['x', t.mixed], ['f', t.filler]] as const) {
    for (const r of list ?? []) {
      const a = Number(r.from);
      const b = Number(r.to);
      if (!(a >= 1) || !(b >= a) || b > MAX_EP) continue;
      for (let n = a; n <= b; n++) k[n] = kind;
    }
  }
  return k;
}

const AFL = 'https://www.animefillerlist.com';
const SHOWS_TTL_MS = 14 * 24 * 3600_000;
const showsItem = storage.defineItem<{ at: number; list: [string, string][] } | null>('local:hp:aflShows', { fallback: null });
const AFL_KIND: Record<string, EpKind> = { anime_canon: 'a', 'mixed_canon/filler': 'x', filler: 'f' };

/** Для порівняння назв: нижній регістр, лише літери й цифри через пробіл. */
export const normTitle = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/×/g, 'x')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Список шоу AFL: [slug, назва] (сам рядок «English (Romaji)» розкладаємо на обидві). */
export function parseShows(html: string): [string, string][] {
  const d = new DOMParser().parseFromString(html, 'text/html');
  const out: [string, string][] = [];
  for (const a of d.querySelectorAll<HTMLAnchorElement>('#ShowList a[href^="/shows/"]')) {
    const slug = decodeURIComponent(a.getAttribute('href')!.slice(7));
    const text = a.textContent?.trim() ?? '';
    if (!slug || !text || /\b(films?|movies?|ovas?|specials?)\b/i.test(text)) continue;
    out.push([slug, text]);
  }
  return out;
}

/**
 * Шоу AFL для тайтлу Hikka: точний збіг нормалізованої назви (англ. або ромадзі). Спершу вся назва шоу, далі — частина
 * до дужок, наостанок — у дужках: інакше «One Pace (One Piece)» перехоплював One Piece, а «Hunter × Hunter (2011)» — версію 1999.
 */
export function findShow(list: [string, string][], titles: (string | null | undefined)[]): string | null {
  const want = new Set(titles.filter((t): t is string => !!t).map(normTitle).filter((t) => t.length >= 3));
  if (!want.size) return null;
  const parts = list.map(([slug, text]) => {
    const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(text);
    return { slug, all: text, main: m?.[1] ?? '', inner: m?.[2] ?? '' };
  });
  for (const key of ['all', 'main', 'inner'] as const) {
    const hit = parts.find((p) => p[key] && want.has(normTitle(p[key])));
    if (hit) return hit.slug;
  }
  return null;
}

/** Сторінка шоу AFL → типи серій. */
export function parseShow(html: string): EpKinds {
  const d = new DOMParser().parseFromString(html, 'text/html');
  const k: EpKinds = {};
  for (const tr of d.querySelectorAll('table.EpisodeList tbody tr')) {
    const n = Number(tr.querySelector('td.Number')?.textContent?.trim());
    if (!(n >= 1) || n > MAX_EP) continue;
    const cls = [...tr.classList].find((c) => c in AFL_KIND);
    if (cls) k[n] = AFL_KIND[cls]!;
  }
  return k;
}

const lastEp = (html: string) => {
  const all = [...html.matchAll(/id="eps-(\d+)"/g)].map((m) => Number(m[1]));
  return all.length ? Math.max(...all) : 0;
};

async function aflShows(): Promise<[string, string][]> {
  const hit = await showsItem.getValue();
  if (hit && Date.now() - hit.at < SHOWS_TTL_MS) return hit.list;
  try {
    const list = parseShows(await getText(`${AFL}/shows`));
    if (list.length > 50) await showsItem.setValue({ at: Date.now(), list });
    return list.length > 50 ? list : (hit?.list ?? []);
  } catch {
    return hit?.list ?? [];
  }
}

/** З AFL: null — шоу не знайшли (або воно не схоже на цей тайтл). */
async function fromAfl(titles: (string | null | undefined)[], total: number): Promise<EpKinds | null> {
  const slug = findShow(await aflShows(), titles);
  if (!slug) return null;
  const html = await getText(`${AFL}/shows/${encodeURIComponent(slug)}`);
  // Інший тайтл з тією ж назвою (рімейк, інший сезон) — серій помітно більше, ніж у Hikka.
  if (total > 0 && lastEp(html) > total + 5) return null;
  return parseShow(html);
}

async function fromMikai(slug: string): Promise<EpKinds> {
  const r = await getJson<Res>(`https://api.mikai.me/public/v1/anime/hikka:${encodeURIComponent(slug)}?include=uaPosters`);
  return parseEpisodeTypes(r.result?.episodeTypes);
}

/** Типи серій тайтлу Hikka: AnimeFillerList, не знайшли — Mikai. titles — англ. назва й ромадзі з Hikka. */
export function getEpisodeTypes(slug: string, titles: (string | null | undefined)[], total: number, ongoing: boolean): Promise<EpKinds> {
  let p = inflight.get(slug);
  if (p) return p;
  p = (async () => {
    const hit = (await item.getValue())[slug];
    if (hit && Date.now() - hit.at < (hit.ongoing ? TTL_ONGOING_MS : TTL_MS)) return hit.k;
    try {
      let k = await fromAfl(titles, total).catch(() => null);
      if (!k) k = await fromMikai(slug);
      const all = { ...(await item.getValue()), [slug]: { at: Date.now(), k, ...(ongoing && { ongoing: true }) } };
      await item.setValue(Object.fromEntries(Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_TITLES)));
      return k;
    } catch {
      return hit?.k ?? {};
    }
  })().finally(() => setTimeout(() => inflight.delete(slug), 60_000));
  inflight.set(slug, p);
  return p;
}

/** Назви й пояснення типів (як легенда «Типи серій» у Mikai, своїми словами). */
export const EP_KIND_INFO: Record<EpKind, [string, string]> = {
  a: ['Канон (аніме)', 'Своя сцена студії в межах основного сюжету'],
  x: ['Змішаний', 'Здебільшого за манґою, зі вставками студії'],
  f: ['Філер', 'Вигадане студією — зазвичай можна пропустити'],
};
