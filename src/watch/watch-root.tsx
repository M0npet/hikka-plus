/*
 * Блок «Перегляд» зі справжніми даними: Hikka (id сайтів, MAL id, кількість серій) → Mikai + AnimeON → WatchBlock.
 * Тут же: збереження позиції, зарахування серії з початку ендингу, лічильник у Hikka.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getJson } from '../core/net';
import { hikkaConfigured, watchScopeItem, tokenItem } from '../core/hikka-auth';
import { startHikkaLogin } from '../features/hikka-sync';
import { animeonTeams, mergeTeams, mikaiTeams, parseWatchLinks } from './providers';
import { aniskipRaw, edFromAniskip, watchedAt } from './threshold';
import { getWatchSaved, updateWatchSaved, useWatchPrefs, type WatchSaved } from './watch-store';
import { HIKKA_LIST_EVENT, WATCH_COUNT_EVENT, WATCH_COUNT_REQ } from '../core/bridge';
import { loadHikkaWatch, markHikkaEpisodes, type HikkaWatchState } from './hikka-watch';
import { WatchBlock, type HikkaLine } from './watch-block';
import type { EpisodeState, WatchTeam } from './types';

type HikkaAnime = {
  slug: string;
  mal_id: number | null;
  episodes_total: number | null;
  episodes_released: number | null;
  external: { url: string; type: string }[] | null;
};

/* ---------- Місце для плеєра в режимі «Ширше» (host над колонками сторінки) ---------- */

let theaterEl: HTMLElement | null = null;
const theaterSubs = new Set<() => void>();
export const theaterStore = {
  set(el: HTMLElement | null) {
    if (el === theaterEl) return;
    theaterEl = el;
    theaterSubs.forEach((f) => f());
  },
  get: () => theaterEl,
  subscribe(f: () => void) {
    theaterSubs.add(f);
    return () => theaterSubs.delete(f);
  },
};

export function TheaterSlot() {
  return <div className="hp-theater" ref={(el) => theaterStore.set(el)} />;
}

/* ---------- Поточна сторінка аніме (оновлює content script при навігації SPA) ---------- */

let animeSlug: string | null = null;
const slugSubs = new Set<() => void>();
export const animePageStore = {
  set(slug: string | null) {
    if (slug === animeSlug) return;
    animeSlug = slug;
    slugSubs.forEach((f) => f());
  },
  get: () => animeSlug,
  subscribe(f: () => void) {
    slugSubs.add(f);
    return () => slugSubs.delete(f);
  },
};

/** Те, що монтується на сторінку: блок для поточного аніме. */
export function AnimeWatch() {
  const slug = useSyncExternalStore(animePageStore.subscribe, animePageStore.get);
  return slug ? <WatchRoot key={slug} slug={slug} /> : null;
}

/* ---------- Контейнер ---------- */

type Load = { status: 'loading' } | { status: 'ready'; teams: WatchTeam[]; anime: HikkaAnime; anitube?: string } | { status: 'not-found'; anitube?: string } | { status: 'error'; message: string };

const SAVE_EVERY_MS = 5000;

export function WatchRoot({ slug }: { slug: string }) {
  const [prefs, setPrefs] = useWatchPrefs();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [saved, setSaved] = useState<WatchSaved | null>(null);
  const [hikka, setHikka] = useState<HikkaWatchState>({ status: 'loading' });
  const [edInfo, setEdInfo] = useState<{ ep: number; at: number; ed: boolean } | null>(null);
  const theater = useSyncExternalStore(theaterStore.subscribe, theaterStore.get);

  // Дані тайтлу й серій.
  useEffect(() => {
    let off = false;
    setLoad({ status: 'loading' });
    setSaved(null);
    void (async () => {
      try {
        const anime = await getJson<HikkaAnime>(`https://api.hikka.io/anime/${slug}`);
        const links = parseWatchLinks(anime.external ?? []);
        const [mk, ao] = await Promise.all([
          links.mikai ? mikaiTeams(links.mikai.id, links.mikai.slug).catch(() => [] as WatchTeam[]) : [],
          links.animeon ? animeonTeams(links.animeon).catch(() => [] as WatchTeam[]) : [],
        ]);
        const teams = mergeTeams(mk, ao);
        const s = await getWatchSaved(slug);
        if (off) return;
        setSaved(s);
        setLoad(teams.length ? { status: 'ready', teams, anime, anitube: links.anitube } : { status: 'not-found', anitube: links.anitube });
      } catch (e) {
        if (!off) setLoad({ status: 'error', message: String((e as Error)?.message ?? e) });
      }
    })();
    return () => {
      off = true;
    };
  }, [slug]);

  // Лічильник серій із віджета Hikka на сторінці (кеш самої Hikka через hikka-bridge) — без нашого входу.
  const [pageN, setPageN] = useState(0);
  useEffect(() => {
    setPageN(0);
    const on = (e: Event) => {
      const d = (e as CustomEvent<unknown>).detail;
      if (typeof d !== 'string') return;
      const [s, n] = d.split('\n');
      if (s === slug) setPageN(Number(n) || 0);
    };
    document.addEventListener(WATCH_COUNT_EVENT, on);
    // Запит міг завантажитися ще до нас, а міст — знайти застосунок не одразу: питаємо кілька разів.
    const ask = () => document.dispatchEvent(new CustomEvent(WATCH_COUNT_REQ, { detail: slug }));
    const ts = [0, 1500, 4000].map((ms) => setTimeout(ask, ms));
    return () => {
      document.removeEventListener(WATCH_COUNT_EVENT, on);
      ts.forEach(clearTimeout);
    };
  }, [slug]);

  // Лічильник у Hikka.
  const reloadHikka = useCallback(() => void loadHikkaWatch(slug).then(setHikka), [slug]);
  useEffect(() => {
    reloadHikka();
    const u1 = tokenItem.watch(reloadHikka);
    const u2 = watchScopeItem.watch(reloadHikka);
    // «+/−» у віджеті Hikka (міст hikka-bridge) — оновити лічильник і відмітки в сітці без F5.
    const onList = (e: Event) => (e as CustomEvent).detail === 'watch' && reloadHikka();
    document.addEventListener(HIKKA_LIST_EVENT, onList);
    return () => {
      u1();
      u2();
      document.removeEventListener(HIKKA_LIST_EVENT, onList);
    };
  }, [reloadHikka]);

  // ---------- Позиція й зарахування ----------
  const live = useRef({ ep: 0, t: 0, lastSave: 0, playerEd: new Map<number, number>(), aniskip: new Map<number, number | null>(), marked: new Set<number>() });
  const anime = load.status === 'ready' ? load.anime : null;
  const total = anime?.episodes_total || anime?.episodes_released || null;

  const markWatched = useCallback(
    (ep: number) => {
      const L = live.current;
      if (L.marked.has(ep)) return;
      L.marked.add(ep);
      void updateWatchSaved(slug, (s) => ({ ...s, eps: { ...s.eps, [ep]: { pos: 1, w: 1, at: Date.now() } } })).then(() =>
        getWatchSaved(slug).then(setSaved),
      );
      if (prefs.hikkaSync && hikka.status === 'ok') void markHikkaEpisodes(slug, ep, total).then(setHikka);
    },
    [slug, prefs.hikkaSync, hikka.status, total],
  );

  const onTime = useCallback(
    (ep: number, t: number, d: number) => {
      const L = live.current;
      L.ep = ep;
      L.t = t;
      // Поріг: мітка плеєра → AniSkip (з перевіркою) → за 90 с до кінця.
      if (anime?.mal_id && !L.aniskip.has(ep)) {
        L.aniskip.set(ep, null);
        void aniskipRaw(anime.mal_id, ep).then((a) => {
          L.aniskip.set(ep, edFromAniskip(a, d));
        });
      }
      const pEd = L.playerEd.get(ep) ?? null;
      const aEd = L.aniskip.get(ep) ?? null;
      const at = watchedAt(d, pEd, aEd);
      const isEd = at === pEd || at === aEd;
      setEdInfo((x) => (x && x.ep === ep && Math.abs(x.at - at) < 1 && x.ed === isEd ? x : { ep, at, ed: isEd }));
      if (t >= at) markWatched(ep);
      const now = Date.now();
      if (now - L.lastSave > SAVE_EVERY_MS) {
        L.lastSave = now;
        void updateWatchSaved(slug, (s) => {
          const prev = s.eps[ep];
          const eps = prev?.w ? s.eps : { ...s.eps, [ep]: { pos: Math.min(0.999, t / d), at: now } };
          return { ...s, eps, ep, t };
        }).then(() => getWatchSaved(slug).then(setSaved));
      }
    },
    [slug, anime?.mal_id, markWatched],
  );

  const onEdStart = useCallback((ep: number, sec: number) => {
    live.current.playerEd.set(ep, sec);
  }, []);

  const onSelect = useCallback(
    (sel: { team: string; player: string; ep: number }) => {
      const L = live.current;
      if (sel.ep !== L.ep) L.t = 0;
      void updateWatchSaved(slug, (s) => ({ ...s, team: sel.team, player: sel.player, ep: sel.ep, t: sel.ep === s.ep ? s.t : 0 }));
    },
    [slug],
  );

  if (!prefs.enabled) return null;

  const episodes: Record<number, EpisodeState> = {};
  for (const [k, v] of Object.entries(saved?.eps ?? {})) episodes[Number(k)] = { pos: v.pos, watched: !!v.w };
  // Переглянуте в списку Hikka (дивився деінде) — теж відмічаємо в сітці 1–N (лише показ, локально не пишемо).
  const hikkaN = Math.max(hikka.status === 'ok' ? hikka.episodes : 0, pageN);
  for (let n = 1; n <= hikkaN; n++) if (!episodes[n]?.watched) episodes[n] = { pos: 1, watched: true };
  // Перша непереглянута після останньої переглянутої — на неї стаємо при заході.
  const lastSeen = Math.max(0, ...Object.entries(episodes).filter(([, v]) => v.watched).map(([k]) => Number(k)));
  const nextEp = lastSeen > 0 && (!total || lastSeen < total) ? lastSeen + 1 : undefined;

  const hikkaLine: HikkaLine =
    hikka.status === 'ok'
      ? { kind: 'count', n: hikka.episodes }
      : (hikka.status === 'scope' || hikka.status === 'off') && hikkaConfigured()
        ? { kind: 'connect', onClick: () => void startHikkaLogin(true) }
        : hikka.status === 'error'
          ? { kind: 'error', message: hikka.message }
          : null;

  return (
    <WatchBlock
      key={`${slug}:${saved ? 1 : 0}`}
      status={load.status === 'ready' ? (saved ? 'ready' : 'loading') : load.status === 'error' ? 'not-found' : load.status}
      error={load.status === 'error' ? load.message : undefined}
      teams={load.status === 'ready' ? load.teams : []}
      episodes={episodes}
      total={total ?? undefined}
      hikka={hikkaLine}
      anitube={load.status === 'ready' || load.status === 'not-found' ? load.anitube : undefined}
      edInfo={edInfo}
      prefs={prefs}
      onPrefs={setPrefs}
      theater={theater}
      initial={saved ? { team: saved.team, player: saved.player, ep: saved.ep, t: saved.t } : undefined}
      resumeAt={() => live.current.t}
      nextEp={nextEp}
      onSelect={onSelect}
      onTime={onTime}
      onEdStart={onEdStart}
      onEnded={markWatched}
    />
  );
}
