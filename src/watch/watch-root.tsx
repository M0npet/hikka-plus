/*
 * Блок «Перегляд» зі справжніми даними: Hikka (id сайтів, MAL id, кількість серій) → Mikai + AnimeON → WatchBlock.
 * Тут же: збереження позиції, зарахування серії з початку ендингу, лічильник у Hikka.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getJson } from '../core/net';
import { hikkaConfigured, watchScopeItem, tokenItem } from '../core/hikka-auth';
import { startHikkaLogin } from '../features/hikka-sync';
import { animeonTeams, mergeTeams, mikaiTeams, parseWatchLinks } from './providers';
import { aniskipRaw, watchedAt, type AniSkip } from './threshold';
import { FLAT, FP_RATE, learnEpisode, storedEpisodes, liveFind, loadFp, mergeMarks, rememberMark, segsFromAniskip, setManualMark, templateFromManual, templates, type Marks, type Seg } from './skip-marks';
import { getWatchSaved, scanAllowedByNetwork, updateWatchSaved, useWatchPrefs, type WatchSaved } from './watch-store';
import { HIKKA_LIST_EVENT, WATCH_COUNT_EVENT, WATCH_COUNT_REQ } from '../core/bridge';
import { loadHikkaWatch, lowerHikkaEpisodes, markHikkaEpisodes, type HikkaWatchState } from './hikka-watch';
import { WatchBlock, type HikkaLine } from './watch-block';
import type { EpisodeState, ScanEnd, ScanJob, WatchTeam } from './types';

type HikkaAnime = {
  slug: string;
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

type Load = { status: 'loading' } | { status: 'ready'; teams: WatchTeam[]; anime: HikkaAnime; anitube?: string } | { status: 'not-found'; anitube?: string } | { status: 'error'; message: string };

const SAVE_EVERY_MS = 5000;

/** Мітки OP/ED поточної серії для блоку: framesOff — кадри плеєра читати не можна (лише мітки плеєра/AniSkip). */
export type MarksInfo = { ep: number; d: number; m: Marks; framesOff: boolean; learned: number };
type SegPair = { op?: Seg; ed?: Seg };

export function WatchRoot({ slug }: { slug: string }) {
  const [prefs, setPrefs] = useWatchPrefs();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [saved, setSaved] = useState<WatchSaved | null>(null);
  const [hikka, setHikka] = useState<HikkaWatchState>({ status: 'loading' });
  const [edInfo, setEdInfo] = useState<{ ep: number; at: number; ed: boolean } | null>(null);
  const [marks, setMarks] = useState<MarksInfo | null>(null);

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
  const live = useRef({
    ep: 0,
    t: 0,
    d: 0,
    lastSave: 0,
    playerSegs: new Map<number, SegPair>(),
    aniskip: new Map<number, AniSkip | null | undefined>(),
    marked: new Set<number>(),
    blocked: new Set<number>(),
    // Мітки OP/ED, знайдені самі (src/watch/skip-marks.ts): відбитки кадрів серій, зразки тайтлу, мітки серій.
    fp: new Map<number, (number | undefined)[]>(),
    fpD: new Map<number, number>(),
    learnedAt: new Map<number, number>(),
    auto: {} as Record<string, SegPair>,
    tpl: { op: null as number[] | null, ed: null as number[] | null },
    framesOff: false,
    learnedEps: 0,
    // «Тут опенінг» / «Тут ендинг»: позначки серій і шматки, з яких ще треба взяти зразок (коли плеєр їх програє).
    manual: {} as Record<string, SegPair>,
    pendTpl: new Map<string, { ep: number; kind: 'op' | 'ed'; seg: Seg }>(),
    // Сканер (0.5.22): уже проскановані шматки (ep:from) і вимкнення на цей захід (кадри недоступні / двічі застряг).
    scanned: new Set<string>(),
    scanFails: 0,
    scanOff: false,
  });
  const anime = load.status === 'ready' ? load.anime : null;
  const total = anime?.episodes_total || anime?.episodes_released || null;

  const markWatched = useCallback(
    (ep: number) => {
      const L = live.current;
      if (L.marked.has(ep) || L.blocked.has(ep)) return;
      L.marked.add(ep);
      void updateWatchSaved(slug, (s) => ({ ...s, eps: { ...s.eps, [ep]: { pos: 1, w: 1, at: Date.now() } } })).then(() =>
        getWatchSaved(slug).then(setSaved),
      );
      if (prefs.hikkaSync && hikka.status === 'ok') void markHikkaEpisodes(slug, ep, total).then(setHikka);
    },
    [slug, prefs.hikkaSync, hikka.status, total],
  );

  // Збережені відбитки/зразки/мітки тайтлу.
  useEffect(() => {
    void loadFp(slug).then((st) => {
      const L = live.current;
      L.auto = { ...st.marks, ...L.auto };
      L.manual = { ...st.man, ...L.manual };
      L.tpl = templates(st);
      L.learnedEps = Object.keys(st.eps).length;
      // Відбитки серій з минулих заходів — щоб сканер не ганяв те, що вже є.
      for (const { ep, a, d } of storedEpisodes(st)) {
        if (L.fp.has(ep)) continue;
        const arr = a.map((v) => (v === FLAT ? undefined : v));
        L.fp.set(ep, arr);
        if (d > 0 && !L.fpD.has(ep)) L.fpD.set(ep, d);
        L.learnedAt.set(ep, arr.filter((v) => v !== undefined).length);
      }
    });
  }, [slug]);

  /** Злити мітки поточної серії й оновити блок і поріг зарахування. Повертає початок ED (або null). */
  const refreshMarks = useCallback((ep: number, d: number): Marks => {
    const L = live.current;
    const m = mergeMarks(d, L.playerSegs.get(ep) ?? {}, L.auto[ep] ?? {}, segsFromAniskip(L.aniskip.get(ep) ?? null, d), L.manual[ep] ?? {});
    setMarks((x) => {
      const nx: MarksInfo = { ep, d, m, framesOff: L.framesOff, learned: L.learnedEps };
      return x && JSON.stringify(x) === JSON.stringify(nx) ? x : nx;
    });
    return m;
  }, []);

  // Порівняти відбитки серії з іншими збереженими й запам'ятати (на кінці серії, при зміні серії, при закритті).
  const learn = useCallback(
    (ep: number, force = false) => {
      const L = live.current;
      const arr = L.fp.get(ep);
      const d = L.fpD.get(ep) ?? L.d;
      if (!arr || !(d > 0)) return;
      const have = arr.filter((v) => v !== undefined).length;
      const prev = L.learnedAt.get(ep) ?? 0;
      if (have - prev < (force ? 1 : 120)) return; // менше хвилини нового — не варто (кінець скану — завжди)
      L.learnedAt.set(ep, have);
      void learnEpisode(slug, ep, arr, d).then((st) => {
        L.auto = { ...L.auto, ...st.marks };
        L.tpl = templates(st);
        L.learnedEps = Object.keys(st.eps).length;
        // Порівняння могло знайти мітки й для серії, яку дивимось (якщо вчилися на сусідній — сканер).
        const cd = L.ep === ep ? d : (L.fpD.get(L.ep) ?? L.d);
        if (L.ep && cd > 0) refreshMarks(L.ep, cd);
      });
    },
    [slug, refreshMarks],
  );
  const learnRef = useRef(learn);
  learnRef.current = learn;
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && learnRef.current(live.current.ep);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      learnRef.current(live.current.ep);
    };
  }, []);

  // Відбитки кадрів із фрейму: накопичуємо й упізнаємо зразки OP/ED тайтлу вже в цій серії.
  const onFp = useCallback(
    (ep: number, fp: string, d: number) => {
      const L = live.current;
      if (d > 0) L.fpD.set(ep, d);
      let arr = L.fp.get(ep);
      if (!arr) L.fp.set(ep, (arr = []));
      const dur = d || L.d;
      let changed = false;
      for (const part of fp.split(';')) {
        if (!part) continue;
        const [a, b] = part.split(',');
        const i = Number(a);
        const h = Number(b);
        if (!(i >= 0 && i < 4 * 3600 * FP_RATE) || !Number.isFinite(h)) continue;
        arr[i] = h;
        for (const kind of ['op', 'ed'] as const) {
          const tpl = L.tpl[kind];
          if (!tpl || L.auto[ep]?.[kind] || L.manual[ep]?.[kind] || L.playerSegs.get(ep)?.[kind]) continue;
          const at = liveFind(arr, i, tpl);
          if (at === null || !(dur > 0)) continue;
          const seg = { s: Math.max(0, at / FP_RATE), e: Math.min(dur, (at + tpl.length) / FP_RATE) };
          // OP — у перших 65 % серії (буває й посередині), ED — у другій половині; інакше це збіг з іншим шматком (анонс, повтор).
          if (kind === 'op' ? seg.s > dur * 0.65 : seg.s < dur * 0.5) continue;
          L.auto[ep] = { ...L.auto[ep], [kind]: seg };
          void rememberMark(slug, ep, kind, seg);
          changed = true;
        }
      }
      if (changed && L.ep === ep && dur > 0) refreshMarks(ep, dur);
      // Ручна позначка: щойно плеєр програв позначений шматок — його кадри стають зразком тайтлу.
      for (const [key, pt] of L.pendTpl) {
        if (pt.ep !== ep || arr.length < Math.floor(pt.seg.e * FP_RATE)) continue;
        L.pendTpl.delete(key);
        void templateFromManual(slug, ep, pt.kind, arr, pt.seg).then((st) => {
          if (st) L.tpl = templates(st);
          else if (!L.pendTpl.has(key) && L.manual[ep]?.[pt.kind]) L.pendTpl.set(key, pt); // кадрів мало — ще раз, коли додадуться
        });
      }
      // Порівнювати з іншими серіями й по ходу перегляду — раз на хвилину нових кадрів (а не лише в кінці / при зміні серії).
      learn(ep);
    },
    [slug, refreshMarks, learn],
  );

  /** «Тут опенінг» / «Тут ендинг» (seg) або прибрати позначку (null). */
  const onManualMark = useCallback(
    (ep: number, kind: 'op' | 'ed', seg: Seg | null) => {
      const L = live.current;
      const key = `${ep}:${kind}`;
      const cur = { ...L.manual[ep] };
      if (seg) cur[kind] = seg;
      else delete cur[kind];
      L.manual = { ...L.manual, [ep]: cur };
      if (seg && !L.framesOff) L.pendTpl.set(key, { ep, kind, seg });
      else L.pendTpl.delete(key);
      void setManualMark(slug, ep, kind, seg).then((st) => {
        L.tpl = templates(st);
      });
      const d = L.fpD.get(ep) ?? L.d;
      if (L.ep === ep && d > 0) refreshMarks(ep, d);
    },
    [slug, refreshMarks],
  );

  /**
   * Сканер міток (0.5.22, plan-marks-v2 §3): що прогнати наступним у прихованому фреймі. null — нічого.
   * Немає зразка OP/ED тайтлу — скануємо цей шматок (OP: 0–6 хв, ED: останні 5 хв) у поточній і сусідній серії
   * → learnEpisode знаходить спільний шматок. Зразок є — скануємо поточну серію наперед лише за увімкненого автопропуску
   * (без нього liveFind і так упізнає OP/ED за ~4 с від початку, а автопропуск спрацьовує лише в перші 3 с).
   */
  const nextScan = useCallback(
    (ep: number, has: (n: number) => boolean): ScanJob | null => {
      const L = live.current;
      if (!prefs.scan || prefs.marks === false || L.framesOff || L.scanOff || !scanAllowedByNetwork()) return null;
      if (L.ep !== ep || L.t < 5 || !(L.d > 0)) return null; // спершу хай піде основний плеєр (реклама, буфер)
      const nb = has(ep + 1) ? ep + 1 : has(ep - 1) ? ep - 1 : null;
      const hasMark = (e: number, k: 'op' | 'ed') => !!(L.manual[e]?.[k] || L.auto[e]?.[k] || L.playerSegs.get(e)?.[k]);
      // Шматок уже є у відбитках (переглянуто чи проскановано раніше) — ≥ 80 % кроків.
      const covered = (e: number, a: number, b: number) => {
        const arr = L.fp.get(e);
        if (!arr || b <= a) return false;
        let n = 0;
        for (let i = Math.floor(a * FP_RATE); i < Math.floor(b * FP_RATE); i++) if (arr[i] !== undefined) n++;
        return n >= (b - a) * FP_RATE * 0.8;
      };
      // Третій шматок — якщо OP немає в перших 6 хв обох серій: опенінг буває й посередині (до 65 % серії).
      const plan: [kind: 'op' | 'ed', from: number, to: number][] = [
        ['op', 0, 360],
        ['ed', -300, 0],
        ['op', 360, Math.round(L.d * 0.65)],
      ];
      for (const [kind, from, to] of plan) {
        if (hasMark(ep, kind) || to > 0 && to <= from) continue;
        let eps: (number | null)[];
        if (L.tpl[kind]) {
          if (!(kind === 'op' ? prefs.skipOp : prefs.skipEd)) continue;
          if (kind === 'op' && L.t > to) continue; // опенінг уже позаду
          eps = [ep];
        } else eps = nb ? [ep, nb] : []; // одна серія — порівнювати нема з чим
        for (const e of eps) {
          if (e === null) continue;
          const d = e === ep ? L.d : L.fpD.get(e);
          if (d && d > 0 && covered(e, from < 0 ? Math.max(0, d + from) : from, to <= 0 ? d : Math.min(to, d))) continue;
          const key = `${e}:${from}`;
          if (L.scanned.has(key)) continue;
          return { ep: e, from, to, kind };
        }
      }
      return null;
    },
    [prefs.scan, prefs.marks, prefs.skipOp, prefs.skipEd],
  );

  const onScanDone = useCallback(
    (job: ScanJob, how: ScanEnd) => {
      const L = live.current;
      L.scanned.add(`${job.ep}:${job.from}`);
      if (how === 'off') L.scanOff = true;
      else if (how === 'stall' && ++L.scanFails >= 2) L.scanOff = true;
      else if (how === 'ok') learn(job.ep, true);
    },
    [learn],
  );

  const onFramesOff = useCallback(() => {
    const L = live.current;
    if (L.framesOff) return;
    L.framesOff = true;
    if (L.d > 0) refreshMarks(L.ep, L.d);
  }, [refreshMarks]);

  const onTime = useCallback(
    (ep: number, t: number, d: number) => {
      const L = live.current;
      if (ep !== L.ep && L.ep) learn(L.ep);
      L.ep = ep;
      L.t = t;
      L.d = d;
      // Мітки: плеєр → знайдені самі → AniSkip (з перевіркою); поріг — початок ED, інакше за 90 с до кінця.
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
      const isEd = edAt !== null && at === edAt;
      setEdInfo((x) => (x && x.ep === ep && Math.abs(x.at - at) < 1 && x.ed === isEd ? x : { ep, at, ed: isEd }));
      // Після «Скасувати» серію не відмічаємо знову, доки позиція не повернеться нижче порогу.
      if (t < at) L.blocked.delete(ep);
      else markWatched(ep);
      // Майже кінець — саме час порівняти відбитки (ED уже пройшов).
      if (t > d * 0.97) learn(ep);
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
    [slug, anime?.mal_id, markWatched, refreshMarks, learn],
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
      if (sel.ep !== L.ep) {
        learn(L.ep);
        L.t = 0;
      }
      L.framesOff = false; // інший плеєр може віддавати кадри
      void updateWatchSaved(slug, (s) => ({ ...s, team: sel.team, player: sel.player, ep: sel.ep, t: sel.ep === s.ep ? s.t : 0 }));
    },
    [slug, learn],
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
      initial={saved ? { team: saved.team, player: saved.player, ep: saved.ep, t: saved.t } : undefined}
      resumeAt={() => live.current.t}
      nextEp={nextEp}
      onSelect={onSelect}
      onTime={onTime}
      onSegs={onSegs}
      marks={marks}
      onFp={onFp}
      onFramesOff={onFramesOff}
      nextScan={nextScan}
      onScanDone={onScanDone}
      onManualMark={onManualMark}
      onEnded={markWatched}
      canUnwatch={canUnwatch}
      onUnwatch={unwatch}
      onMark={markManual}
    />
  );
}
