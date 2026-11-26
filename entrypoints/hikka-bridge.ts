import { defineUnlistedScript } from '#imports';
import { CARDS_EVENT, CARDS_REQ, HIKKA_LIST_EVENT, NAV_EVENT, READ_CHANGED_EVENT, READ_COUNT_EVENT, READ_COUNT_REQ, TITLE_LANG_EVENT, TITLE_LANG_REQ, WATCH_COUNT_EVENT, WATCH_COUNT_REQ, type CardRow } from '@/src/core/bridge';

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

  /** Запит `profileUi` (GET /user/me/ui, лише після входу) → мова назв для content script (src/core/title-lang.ts). */
  function reportLang(q: QueryStateLike) {
    const k = q.queryKey[0] as { _id?: unknown } | undefined;
    if (!k || typeof k !== 'object' || k._id !== 'profileUi' || q.state?.status !== 'success') return;
    const v = (q.state.data as { preferences?: { title_language?: unknown } } | null)?.preferences?.title_language;
    if (typeof v === 'string' && v) document.dispatchEvent(new CustomEvent(TITLE_LANG_EVENT, { detail: v }));
  }
  function scanLang() {
    client ??= findClient();
    try {
      client?.getQueryCache().getAll?.().forEach(reportLang);
    } catch {
      client = null;
    }
  }
  document.addEventListener(TITLE_LANG_REQ, scanLang);

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
  /** Манґа/ранобе (MangaResponse/NovelResponse бекенду Hikka): data_type, slug, chapters, status, `read` — запис того, хто зайшов. */
  type Book = { data_type?: unknown; slug?: unknown; chapters?: unknown; status?: unknown; read?: unknown };
  const isBook = (a: unknown): a is Book =>
    !!a && typeof a === 'object' && ((a as Book).data_type === 'manga' || (a as Book).data_type === 'novel') && typeof (a as Book).slug === 'string';
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
    // Манґа/ранобе — ключ `<manga|novel>:<slug>`; [ключ, -1 (вихід рахує розширення), розділів усього, статус, прочитано, статус читання].
    const putBook = (b: Book, own?: { chapters?: unknown; status?: unknown }) => {
      const key = `${b.data_type as string}:${b.slug as string}`;
      const r = rows.get(key) ?? [key, -1, -1, '', -1, ''];
      if (int(b.chapters) >= 0) r[2] = int(b.chapters);
      if (typeof b.status === 'string') r[3] = b.status;
      const e = own ?? (Array.isArray(b.read) ? (b.read[0] as { chapters?: unknown; status?: unknown } | undefined) : undefined);
      if (e && int(e.chapters) >= 0) {
        r[4] = int(e.chapters);
        r[5] = typeof e.status === 'string' ? e.status : '';
      }
      rows.set(key, r);
    };
    const walk = (v: unknown, ownList: boolean, depth: number) => {
      if (!v || typeof v !== 'object' || depth > 6) return;
      if (Array.isArray(v)) return v.forEach((x) => walk(x, ownList, depth + 1));
      if (isAnime(v)) return put(v);
      if (isBook(v)) return putBook(v);
      const o = v as { anime?: unknown; content?: unknown; episodes?: unknown; chapters?: unknown; status?: unknown };
      // Запис списку {anime, episodes, status}: чужий список — лише дані тайтлу, без «переглянуто».
      if (isAnime(o.anime)) return put(o.anime, ownList && int(o.episodes) >= 0 ? o : undefined);
      // Запис списку читання {content, chapters, status} (ReadResponse).
      if (isBook(o.content)) return putBook(o.content, ownList && int(o.chapters) >= 0 ? o : undefined);
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
      if (id === 'readGet') {
        const slug = k.path?.slug;
        const ct = (k.path as { content_type?: unknown } | undefined)?.content_type;
        const d = q.state.data as { content?: unknown; chapters?: unknown; status?: unknown };
        if (typeof slug === 'string' && (ct === 'manga' || ct === 'novel')) putBook(isBook(d.content) ? d.content : { data_type: ct, slug }, d);
        continue;
      }
      // Лише кеш зі списками тайтлів (не коментарі, не статистика): усе, де трапляються об'єкти аніме, манґи, ранобе.
      if (!/anime|manga|novel|read|watch|schedule|franchise|collection|recommend|search/i.test(id)) continue;
      // Свій список (userWatchList / список читання) — за ім'ям того, хто зайшов; чужий — лише дані тайтлів.
      const own = !!me && k.path?.username === me && /watch|read/i.test(id);
      walk(q.state.data, own, 0);
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
    scanLang();
    unsub = client.getQueryCache().subscribe((ev) => {
      if (ev.type !== 'updated' || ev.action?.type !== 'success') return;
      sendCards();
      reportLang(ev.query);
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

  // «Продовжити» у віконці картки (src/cards/popup.ts): перехід роутером самої Hikka (TanStack Router), без перезавантаження.
  // Шлях лише свій: /anime|manga|novel/<slug>[#read=…]. Читалка слухає hashchange — після переходу кажемо їй про #read.
  document.addEventListener(NAV_EVENT, (e) => {
    const path = (e as CustomEvent<unknown>).detail;
    if (typeof path !== 'string' || !/^\/(anime|manga|novel)\/[^/?#]+(#read=[^\s]*)?$/.test(path)) return;
    const [to, hash] = path.split('#') as [string, string | undefined];
    const router = (window as unknown as { __TSR_ROUTER__?: { navigate?: (o: { to: string; hash?: string }) => Promise<unknown> } }).__TSR_ROUTER__;
    if (typeof router?.navigate !== 'function') return void location.assign(path);
    void Promise.resolve(router.navigate({ to, hash }))
      .then(() => {
        if (hash) setTimeout(() => window.dispatchEvent(new HashChangeEvent('hashchange')), 400);
      })
      .catch(() => location.assign(path));
  });
});
