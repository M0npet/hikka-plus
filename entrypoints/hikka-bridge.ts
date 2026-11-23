import { defineUnlistedScript } from '#imports';
import { CARDS_EVENT, CARDS_REQ, HIKKA_LIST_EVENT, READ_CHANGED_EVENT, READ_COUNT_EVENT, READ_COUNT_REQ, WATCH_COUNT_EVENT, WATCH_COUNT_REQ, type CardRow } from '@/src/core/bridge';

/**
 * Виконується в контексті сторінки hikka.io (не в ізольованому світі content script).
 * Після того як Hikka Plus записав прогрес у список Hikka (PUT /read), просимо кеш
 * TanStack Query самої Hikka перезапитати дані цього тайтлу — віджет «у списку» зліва
 * оновлюється одразу, без F5. Так само робить сама Hikka після своїх змін
 * (`applyReadMutation` → `invalidateReadState` у @hikka/core). DOM Hikka не чіпаємо.
 */
interface QueryLike {
  queryKey: unknown[];
}
interface QueryStateLike extends QueryLike {
  state?: { status?: string; dataUpdatedAt?: number; data?: unknown; error?: unknown };
}
interface CacheEvent {
  type: string;
  query: QueryStateLike;
  action?: { type?: string };
}
interface QueryCacheLike {
  subscribe(cb: (e: CacheEvent) => void): () => void;
  getAll?(): QueryStateLike[];
}
interface QueryClientLike {
  getQueryCache(): QueryCacheLike;
  invalidateQueries(filters: { predicate: (q: QueryLike) => boolean }): Promise<void>;
}

export default defineUnlistedScript(() => {
  let client: QueryClientLike | null = null;

  /** QueryClientProvider — предок будь-якого елемента застосунку; шукаємо його в дереві React. */
  function findClient(): QueryClientLike | null {
    const el = document.querySelector('#content-left-side') ?? document.querySelector('main') ?? document.body;
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
    let fiber = key ? (el as unknown as Record<string, { memoizedProps?: { client?: unknown }; return?: unknown }>)[key] : null;
    for (let i = 0; fiber && i < 200; i++) {
      const c = fiber.memoizedProps?.client as QueryClientLike | undefined;
      if (c && typeof c.getQueryCache === 'function' && typeof c.invalidateQueries === 'function') return c;
      fiber = fiber.return as typeof fiber;
    }
    return null;
  }

  // Зворотний бік: Hikka сама змінила свій запис (напр. «+/−» у віджеті «у списку») — кажемо content script
  // перечитати число з Hikka. Ловимо успішні оновлення запитів читання/перегляду в кеші TanStack Query.
  let unsub: (() => void) | null = null;

  /** Запит `watchGet` (віджет «у списку» аніме) → лічильник серій для content script. */
  function reportWatch(q: QueryStateLike, want?: string) {
    const k = q.queryKey[0] as { _id?: unknown; path?: { slug?: unknown } } | undefined;
    if (!k || typeof k !== 'object' || k._id !== 'watchGet') return;
    const slug = typeof k.path?.slug === 'string' ? k.path.slug : '';
    if (!slug || (want && slug !== want)) return;
    const st = q.state;
    let n: number | null = null;
    if (st?.status === 'success') n = Number((st.data as { episodes?: unknown } | null)?.episodes ?? 0) || 0;
    else if (st?.status === 'error') n = 0; // тайтлу немає в списку
    if (n === null) return;
    document.dispatchEvent(new CustomEvent(WATCH_COUNT_EVENT, { detail: `${slug}\n${n}` }));
  }
  /** Запит `readGet` (віджет «у списку» манги/ранобе) → кількість прочитаних розділів для content script. */
  function reportRead(q: QueryStateLike, want?: string) {
    const k = q.queryKey[0] as { _id?: unknown; path?: { slug?: unknown; content_type?: unknown } } | undefined;
    if (!k || typeof k !== 'object' || k._id !== 'readGet') return;
    const slug = typeof k.path?.slug === 'string' ? k.path.slug : '';
    const ct = typeof k.path?.content_type === 'string' ? k.path.content_type : '';
    if (!slug || (want && slug !== want)) return;
    const st = q.state;
    let n: number | null = null;
    if (st?.status === 'success') n = Number((st.data as { chapters?: unknown } | null)?.chapters ?? 0) || 0;
    else if (st?.status === 'error') n = 0; // тайтлу немає в списку
    if (n === null) return;
    document.dispatchEvent(new CustomEvent(READ_COUNT_EVENT, { detail: `${ct}\n${slug}\n${n}` }));
  }
  /* ---------- Плашки на картках аніме (src/cards/) ---------- */

  type Anime = { data_type?: unknown; slug?: unknown; episodes_released?: unknown; episodes_total?: unknown; status?: unknown; watch?: unknown };
  type Entry = { episodes?: unknown; status?: unknown };
  const isAnime = (a: unknown): a is Anime => !!a && typeof a === 'object' && (a as Anime).data_type === 'anime' && typeof (a as Anime).slug === 'string';
  const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : -1);

  /** Знімок того, що кеш Hikka знає про аніме на сторінці: випущені серії й запис у списку того, хто зайшов. */
  function collectCards(): CardRow[] {
    const all = client?.getQueryCache().getAll?.() ?? [];
    let me = '';
    for (const q of all) {
      const k = q.queryKey[0] as { _id?: unknown } | undefined;
      const u = (q.state?.data as { username?: unknown } | undefined)?.username;
      if (k && typeof k === 'object' && k._id === 'profile' && typeof u === 'string') me = u;
    }
    const rows = new Map<string, CardRow>();
    const put = (a: Anime, w?: Entry) => {
      const slug = a.slug as string;
      const r = rows.get(slug) ?? [slug, -1, -1, '', -1, ''];
      if (int(a.episodes_released) >= 0) r[1] = int(a.episodes_released);
      if (int(a.episodes_total) >= 0) r[2] = int(a.episodes_total);
      if (typeof a.status === 'string') r[3] = a.status;
      // У каталозі й календарі `watch` — запис саме того, хто зайшов (AnimeResponseWithWatch); [] — тайтлу немає в списку.
      const own = w ?? (Array.isArray(a.watch) ? (a.watch[0] as Entry | undefined) : undefined);
      if (own && int(own.episodes) >= 0) {
        r[4] = int(own.episodes);
        r[5] = typeof own.status === 'string' ? own.status : '';
      }
      rows.set(slug, r);
    };
    const walk = (v: unknown, ownList: boolean, depth: number) => {
      if (!v || typeof v !== 'object' || depth > 6) return;
      if (Array.isArray(v)) return v.forEach((x) => walk(x, ownList, depth + 1));
      if (isAnime(v)) return put(v);
      const o = v as { anime?: unknown; episodes?: unknown; status?: unknown };
      // Запис списку {anime, episodes, status}: чужий список — лише дані тайтлу, без «переглянуто».
      if (isAnime(o.anime)) return put(o.anime, ownList && int(o.episodes) >= 0 ? o : undefined);
      for (const x of Object.values(v)) if (x && typeof x === 'object') walk(x, ownList, depth + 1);
    };
    for (const q of all) {
      if (q.state?.status !== 'success' || !q.state.data) continue;
      const k = q.queryKey[0] as { _id?: unknown; path?: { slug?: unknown; username?: unknown } } | undefined;
      if (!k || typeof k !== 'object') continue;
      const id = String(k._id ?? '');
      if (id === 'watchGet') {
        const slug = k.path?.slug;
        const d = q.state.data as Entry & { anime?: unknown };
        if (typeof slug === 'string') put(isAnime(d.anime) ? d.anime : ({ slug } as Anime), d);
        continue;
      }
      // Лише кеш зі списками тайтлів (не коментарі, не статистика): усе, де трапляються об'єкти аніме.
      if (!/anime|watch|schedule|franchise|collection|recommend|search/i.test(id)) continue;
      walk(q.state.data, id === 'userWatchList' && !!me && k.path?.username === me, 0);
    }
    return [...rows.values()];
  }
  let cardsSent = '';
  let cardsTimer = 0;
  function sendCards(force = false) {
    window.clearTimeout(cardsTimer);
    cardsTimer = window.setTimeout(() => {
      let json = '';
      try {
        json = JSON.stringify(collectCards());
      } catch {
        return;
      }
      if (!force && json === cardsSent) return;
      cardsSent = json;
      document.dispatchEvent(new CustomEvent(CARDS_EVENT, { detail: json }));
    }, force ? 0 : 250);
  }
  document.addEventListener(CARDS_REQ, () => {
    client ??= findClient();
    if (client) sendCards(true);
  });

  const last = new Map<string, number>();
  function watchCache() {
    if (unsub) return;
    client ??= findClient();
    if (!client) return;
    sendCards(true);
    unsub = client.getQueryCache().subscribe((ev) => {
      if (ev.type !== 'updated' || ev.action?.type !== 'success') return;
      sendCards();
      reportWatch(ev.query);
      reportRead(ev.query);
      const k = ev.query.queryKey[0] as { _id?: unknown } | undefined;
      const id = k && typeof k === 'object' ? String(k._id ?? '') : '';
      // Лише сам запис у списку (віджет «у списку»), не статистика й «читають друзі».
      const kind = id === 'watchGet' ? 'watch' : id === 'readGet' ? 'read' : '';
      if (!kind) return;
      const at = ev.query.state?.dataUpdatedAt ?? 0;
      const key = JSON.stringify(ev.query.queryKey);
      if (last.get(key) === at) return;
      last.set(key, at);
      document.dispatchEvent(new CustomEvent(HIKKA_LIST_EVENT, { detail: kind }));
    });
  }
  // Застосунок Hikka з'являється не одразу й може перемонтуватися — пробуємо періодично.
  watchCache();
  const retry = setInterval(() => {
    if (unsub) return clearInterval(retry);
    watchCache();
  }, 1000);
  setTimeout(() => clearInterval(retry), 60_000);

  document.addEventListener(WATCH_COUNT_REQ, (e) => {
    const slug = (e as CustomEvent<unknown>).detail;
    if (typeof slug !== 'string' || !slug) return;
    client ??= findClient();
    try {
      client?.getQueryCache().getAll?.().forEach((q) => reportWatch(q, slug));
    } catch {
      client = null;
    }
  });

  document.addEventListener(READ_COUNT_REQ, (e) => {
    const slug = (e as CustomEvent<unknown>).detail;
    if (typeof slug !== 'string' || !slug) return;
    client ??= findClient();
    try {
      client?.getQueryCache().getAll?.().forEach((q) => reportRead(q, slug));
    } catch {
      client = null;
    }
  });

  document.addEventListener(READ_CHANGED_EVENT, (e) => {
    const slug = (e as CustomEvent<unknown>).detail;
    if (typeof slug !== 'string' || !slug) return;
    // «watch:<slug>» — змінився список перегляду (серії), інакше — читання.
    const re = slug.startsWith('watch:') ? /watch/i : /read/i;
    client ??= findClient();
    if (!client) return;
    void client
      .invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0] as { _id?: unknown } | undefined;
          // Лише запити про читання: запис у списку (readGet — віджет зліва), getReadFollowing,
          // списки й статистика читання. Опис, коментарі тощо не перезапитуємо.
          return !!k && typeof k === 'object' && re.test(String(k._id ?? ''));
        },
      })
      .catch(() => {
        client = null; // застосунок міг перемонтуватися — наступного разу знайдемо заново
      });
  });
});
