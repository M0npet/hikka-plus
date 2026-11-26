/*
 * Блок «Перегляд» зі справжніми даними: Hikka (id сайтів, MAL id, кількість серій) → Mikai + AnimeON → WatchBlock.
 * Тут же: збереження позиції, зарахування серії з початку ендингу, лічильник у Hikka.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { getJson } from '../core/net';
import { hikkaConfigured, watchScopeItem, tokenItem } from '../core/hikka-auth';
import { startHikkaLogin } from '../features/hikka-sync';
import { animeonTeams, mergeTeams, mikaiTeamsFor, parseWatchLinks, type UaLicense } from './providers';
import { aniskipRaw, watchedAt, type AniSkip } from './threshold';
import { mergeMarks, segsFromAniskip, type Marks, type Seg } from './skip-marks';
import { flushWatchPush, getWatchSaved, pullWatchSaved, updateWatchSaved, useWatchPrefs, watchSyncedWatch, type WatchSaved } from './watch-store';
import { noteDubSeen } from './dub-alerts';
import { epTitleText, getEpisodeTitles, type EpTitles } from './episode-titles';
import { getSequel, sequelTitle, type Sequel } from './sequel';
import { pickTitle, titleLangItem } from '../core/title-lang';
import { useTitleLang } from '../ui/use-title-lang';
import { HIKKA_LIST_EVENT, WATCH_COUNT_EVENT, WATCH_COUNT_REQ } from '../core/bridge';
import { navigate } from '../cards/popup';
import { loadHikkaWatch, lowerHikkaEpisodes, markHikkaEpisodes, type HikkaWatchState } from './hikka-watch';
import { WatchBlock, type HikkaLine } from './watch-block';
import type { EpisodeState, WatchTeam } from './types';

type HikkaAnime = {
  slug: string;
  title_ua?: string | null;
  title_en?: string | null;
  title_ja?: string | null;
  mal_id: number | null;
  episodes_total: number | null;
  episodes_released: number | null;
  external: { url: string; type: string }[] | null;
};

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

type Load =
  | { status: 'loading' }
  | { status: 'ready'; teams: WatchTeam[]; anime: HikkaAnime; license?: UaLicense }
  | { status: 'not-found'; license?: UaLicense }
  | { status: 'error'; message: string };

const SAVE_EVERY_MS = 5000;

/** Мітки OP/ED поточної серії для блоку (плеєр → AniSkip). */
export type MarksInfo = { ep: number; d: number; m: Marks };
type SegPair = { op?: Seg; ed?: Seg };

function WatchRoot({ slug }: { slug: string }) {
  const [prefs, setPrefs] = useWatchPrefs();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [saved, setSaved] = useState<WatchSaved | null>(null);
  const [hikka, setHikka] = useState<HikkaWatchState>({ status: 'loading' });
  const [edInfo, setEdInfo] = useState<{ ep: number; at: number; own: boolean } | null>(null);
  const [marks, setMarks] = useState<MarksInfo | null>(null);
  // Мова назв — як у користувача Hikka (src/core/title-lang.ts).
  const lang = useTitleLang();
  const [epRaw, setEpRaw] = useState<EpTitles>({});

  // Назви серій (Hikka /episodes, кеш на 3 дні) — меню серій, сітка, «Наступна серія».
  useEffect(() => {
    let off = false;
    setEpRaw({});
    void getEpisodeTitles(slug).then((t) => !off && setEpRaw(t));
    return () => {
      off = true;
    };
  }, [slug]);
  const epTitles = useMemo(() => {
    const m: Record<number, string> = {};
    for (const [n, v] of Object.entries(epRaw)) m[Number(n)] = epTitleText(v, lang);
    return m;
  }, [epRaw, lang]);

  // Наступний сезон (Hikka franchise → sequel) — кнопка поверх плеєра на останній серії.
  const [seqRaw, setSeqRaw] = useState<Sequel | null>(null);
  useEffect(() => {
    let off = false;
    setSeqRaw(null);
    void getSequel(slug).then((s) => !off && setSeqRaw(s));
    return () => {
      off = true;
    };
  }, [slug]);
  const sequel = useMemo(() => (seqRaw ? { slug: seqRaw.slug, title: sequelTitle(seqRaw, lang), soon: seqRaw.soon } : null), [seqRaw, lang]);
  // SPA-перехід Hikka через міст — без перезавантаження; є серії — одразу до плеєра нового сезону.
  const onSequel = useCallback((to: string) => navigate(`/anime/${to}`, !sequel?.soon), [sequel]);

  // Нові серії в озвучках (dub-alerts.ts): стежимо за командою Mikai, яку дивляться, і все, що вийшло, — побачене.
  const dubRef = useRef<{ name: string; mikai: WatchTeam[] } | null>(null);
  const noteDub = useCallback(
    (s: WatchSaved) => {
      const d = dubRef.current;
      if (!d || !s.team || !Object.keys(s.eps).length) return;
      const t = d.mikai.find((x) => x.id === s.team);
      const n = t ? Math.max(0, ...t.players.flatMap((p) => p.episodes)) : 0;
      void noteDubSeen(slug, { name: d.name, team: s.team, tn: t?.name ?? s.team, n });
    },
    [slug],
  );

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
          mikaiTeamsFor(slug, links.mikai).catch(() => ({ teams: [] as WatchTeam[], license: undefined })),
          links.animeon ? animeonTeams(links.animeon).catch(() => [] as WatchTeam[]) : [],
        ]);
        const teams = mergeTeams(mk.teams, ao);
        const license = mk.license;
        await pullWatchSaved(slug); // позиція з інших пристроїв (якщо там новіша)
        const s = await getWatchSaved(slug);
        const lang = await titleLangItem.getValue();
        if (off) return;
        setSaved(s);
        const name = pickTitle({ ua: anime.title_ua, en: anime.title_en, ja: anime.title_ja }, lang) || slug;
        dubRef.current = { name, mikai: mk.teams };
        noteDub(s);
        setLoad(teams.length ? { status: 'ready', teams, anime, license } : { status: 'not-found', license });
      } catch (e) {
        if (!off) setLoad({ status: 'error', message: String((e as Error)?.message ?? e) });
      }
    })();
    return () => {
      off = true;
    };
  }, [slug]);

  // Інший пристрій оновив позицію, поки сторінка відкрита — перечитати; йдемо з тайтлу — дослати своє в sync.
  useEffect(() => {
    const unwatch = watchSyncedWatch(slug, () => void getWatchSaved(slug).then(setSaved));
    const flush = () => flushWatchPush(slug);
    window.addEventListener('pagehide', flush);
    return () => {
      unwatch();
      window.removeEventListener('pagehide', flush);
      flush();
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
  // Помилка фону (немає відповіді тощо) — показуємо її, а не вічне «завантаження» без рядка Hikka (MK 2026-11-26).
  const reloadHikka = useCallback(
    () =>
      void loadHikkaWatch(slug)
        .then(setHikka)
        .catch((e) => setHikka({ status: 'error', message: String((e as Error)?.message ?? e) })),
    [slug],
  );
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
  const live = useRef({
    ep: 0,
    t: 0,
    d: 0,
    lastSave: 0,
    playerSegs: new Map<number, SegPair>(),
    aniskip: new Map<number, AniSkip | null | undefined>(),
    marked: new Set<number>(),
    blocked: new Set<number>(),
  });
  const anime = load.status === 'ready' ? load.anime : null;
  const total = anime?.episodes_total || anime?.episodes_released || null;

  // Лічильник Hikka: найбільша серія, зарахована в цьому заході. Не вдалося (мережа, Hikka ще вантажилась, токен) —
  // пробуємо знову на наступному onTime/при зміні стану Hikka, а не губимо (MK 2026-11-26: «серии не отмечаются»).
  const hikkaRef = useRef({ ok: false, sync: false, episodes: 0, total: null as number | null, busy: false, failAt: 0 });
  hikkaRef.current.ok = hikka.status === 'ok';
  hikkaRef.current.sync = !!prefs.hikkaSync;
  hikkaRef.current.episodes = hikka.status === 'ok' ? hikka.episodes : 0;
  hikkaRef.current.total = total;
  const pushHikka = useCallback(() => {
    const H = hikkaRef.current;
    const L = live.current;
    let n = 0;
    for (const e of L.marked) if (!L.blocked.has(e) && e > n) n = e;
    if (H.total && n > H.total) n = H.total;
    if (!n || H.busy || !H.sync || !H.ok || H.episodes >= n || Date.now() - H.failAt < 30_000) return;
    H.busy = true;
    void markHikkaEpisodes(slug, n, H.total)
      .then((st) => {
        // Помилка мережі — не міняємо стан Hikka (інакше рядок «помилка» і більше жодної спроби), а повторимо за 30 с.
        if (st.status === 'error') {
          H.failAt = Date.now();
          console.info('[Hikka Plus] серію в Hikka не записано, повторимо:', st.message);
        } else setHikka(st);
      })
      .catch((e) => {
        H.failAt = Date.now();
        console.info('[Hikka Plus] серію в Hikka не записано, повторимо:', e);
      })
      .finally(() => {
        H.busy = false;
      });
  }, [slug]);
  useEffect(() => {
    if (hikka.status === 'ok') pushHikka();
  }, [hikka, prefs.hikkaSync, pushHikka]);

  const markWatched = useCallback(
    (ep: number) => {
      const L = live.current;
      if (L.blocked.has(ep)) return;
      if (!L.marked.has(ep)) {
        L.marked.add(ep);
        void updateWatchSaved(slug, (s) => ({ ...s, eps: { ...s.eps, [ep]: { pos: 1, w: 1, at: Date.now() } } })).then(() =>
          getWatchSaved(slug).then((s) => {
            setSaved(s);
            noteDub(s);
          }),
        );
      }
      pushHikka();
    },
    [slug, pushHikka, noteDub],
  );


  /** Злити мітки поточної серії й оновити блок і поріг зарахування. Повертає початок ED (або null). */
  const refreshMarks = useCallback((ep: number, d: number): Marks => {
    const L = live.current;
    const m = mergeMarks(d, L.playerSegs.get(ep) ?? {}, segsFromAniskip(L.aniskip.get(ep) ?? null, d));
    setMarks((x) => {
      const nx: MarksInfo = { ep, d, m };
      return x && JSON.stringify(x) === JSON.stringify(nx) ? x : nx;
    });
    return m;
  }, []);

  const onTime = useCallback(
    (ep: number, t: number, d: number) => {
      const L = live.current;
      L.ep = ep;
      L.t = t;
      L.d = d;
      // Мітки: плеєр → AniSkip (з перевіркою); поріг — початок ED, інакше приблизно (fallbackSec).
      if (anime?.mal_id && !L.aniskip.has(ep)) {
        L.aniskip.set(ep, undefined);
        void aniskipRaw(anime.mal_id, ep).then((a) => {
          L.aniskip.set(ep, a);
          if (L.ep === ep) refreshMarks(ep, L.d);
        });
      }
      const m = refreshMarks(ep, d);
      const edAt = m.ed?.s ?? null;
      const at = watchedAt(d, edAt, null);
      // own — поріг = початок ендингу з міток самого плеєра (Moon, Fenix): він уже показує його на своїй смужці.
      const own = m.ed?.src === 'player' && at === edAt;
      setEdInfo((x) => (x && x.ep === ep && Math.abs(x.at - at) < 1 && x.own === own ? x : { ep, at, own }));
      // Після «Скасувати» серію не відмічаємо знову, доки позиція не повернеться нижче порогу.
      if (t < at) L.blocked.delete(ep);
      else markWatched(ep);
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
    [slug, anime?.mal_id, markWatched, refreshMarks],
  );

  // Позначити вручну (глазок у сітці): як дійти до кінця — локально + лічильник Hikka до n.
  const markManual = useCallback(
    (ep: number) => {
      const L = live.current;
      L.blocked.delete(ep);
      L.marked.delete(ep);
      markWatched(ep);
    },
    [markWatched],
  );

  // Зняти відмітку «переглянуто» (MK 2026-11-23, 03:47): локально + лічильник Hikka до ep−1, якщо там серія вже зарахована.
  const unwatch = useCallback(
    (ep: number) => {
      const L = live.current;
      L.marked.delete(ep);
      L.blocked.add(ep);
      const hN = Math.max(hikka.status === 'ok' ? hikka.episodes : 0, pageN);
      const now = Date.now();
      void updateWatchSaved(slug, (s) => {
        const eps = { ...s.eps };
        // Лічильник Hikka опуститься до ep−1 — серії після ep, зараховані лише в Hikka, лишаємо відміченими в нас
        // (як «прочитано» в читалці: у Hikka — до останньої поспіль, у нас — усе відмічене).
        for (let n = ep + 1; n <= hN; n++) if (!eps[n]?.w) eps[n] = { pos: 1, w: 1, at: now };
        delete eps[ep];
        return { ...s, eps };
      }).then(() => getWatchSaved(slug).then(setSaved));
      if (ep > hN) return;
      setPageN((n) => Math.min(n, ep - 1));
      if (prefs.hikkaSync && hikka.status === 'ok') void lowerHikkaEpisodes(slug, ep - 1).then(setHikka);
    },
    [slug, hikka, pageN, prefs.hikkaSync],
  );

  const onSegs = useCallback(
    (ep: number, segs: SegPair) => {
      const L = live.current;
      L.playerSegs.set(ep, { ...L.playerSegs.get(ep), ...segs });
      if (L.ep === ep && L.d > 0) refreshMarks(ep, L.d);
    },
    [refreshMarks],
  );

  const onSelect = useCallback(
    (sel: { team: string; player: string; ep: number }) => {
      const L = live.current;
      if (sel.ep !== L.ep) L.t = 0;
      void updateWatchSaved(slug, (s) => ({ ...s, team: sel.team, player: sel.player, ep: sel.ep, t: sel.ep === s.ep ? s.t : 0 }))
        .then(() => getWatchSaved(slug))
        .then(noteDub);
    },
    [slug, noteDub],
  );

  if (!prefs.enabled) return null;

  const episodes: Record<number, EpisodeState> = {};
  for (const [k, v] of Object.entries(saved?.eps ?? {})) episodes[Number(k)] = { pos: v.pos, watched: !!v.w };
  // Переглянуте в списку Hikka (дивився деінде) — теж відмічаємо в сітці 1–N (лише показ, локально не пишемо).
  const hikkaN = Math.max(hikka.status === 'ok' ? hikka.episodes : 0, pageN);
  for (let n = 1; n <= hikkaN; n++) if (!episodes[n]?.watched) episodes[n] = { pos: 1, watched: true };
  // Перша непереглянута після останньої переглянутої — на неї стаємо при заході.
  const lastSeen = Math.max(0, ...Object.entries(episodes).filter(([, v]) => v.watched).map(([k]) => Number(k)));
  // Серію з лічильника Hikka можна зняти лише тоді, коли ми можемо записати в Hikka.
  const canUnwatch = (n: number) => !!episodes[n]?.watched && (n > hikkaN || (prefs.hikkaSync && hikka.status === 'ok'));
  const nextEp = lastSeen > 0 && (!total || lastSeen < total) ? lastSeen + 1 : undefined;

  const hikkaLine: HikkaLine =
    hikka.status === 'ok'
      ? { kind: 'count', n: hikka.episodes }
      : (hikka.status === 'scope' || hikka.status === 'off') && hikkaConfigured()
        ? { kind: 'connect', onClick: () => void startHikkaLogin(true) }
        : hikka.status === 'error'
          ? { kind: 'error', message: hikka.message }
          : (hikka.status === 'scope' || hikka.status === 'off') && prefs.hikkaSync
            ? { kind: 'error', message: 'Ця збірка без клієнта Hikka — серії в Hikka не відмічаються (немає .env.local під час збірки)' }
            : null;

  return (
    <WatchBlock
      key={`${slug}:${saved ? 1 : 0}`}
      status={load.status === 'ready' ? (saved ? 'ready' : 'loading') : load.status === 'error' ? 'not-found' : load.status}
      error={load.status === 'error' ? load.message : undefined}
      teams={load.status === 'ready' ? load.teams : []}
      episodes={episodes}
      epTitles={epTitles}
      sequel={sequel}
      onSequel={onSequel}
      total={total ?? undefined}
      hikka={hikkaLine}
      license={load.status === 'ready' || load.status === 'not-found' ? load.license : undefined}
      edInfo={edInfo}
      prefs={prefs}
      onPrefs={setPrefs}
      initial={saved ? { team: saved.team, player: saved.player, ep: saved.ep, t: saved.t } : undefined}
      resumeAt={() => live.current.t}
      nextEp={nextEp}
      onSelect={onSelect}
      onTime={onTime}
      onSegs={onSegs}
      marks={marks}
      onEnded={markWatched}
      canUnwatch={canUnwatch}
      onUnwatch={unwatch}
      onMark={markManual}
    />
  );
}
