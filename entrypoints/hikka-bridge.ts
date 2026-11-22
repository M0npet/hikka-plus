import { defineUnlistedScript } from '#imports';
import { READ_CHANGED_EVENT } from '@/src/core/bridge';

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
interface QueryClientLike {
  getQueryCache(): unknown;
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

  document.addEventListener(READ_CHANGED_EVENT, (e) => {
    const slug = (e as CustomEvent<unknown>).detail;
    if (typeof slug !== 'string' || !slug) return;
    client ??= findClient();
    if (!client) return;
    void client
      .invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0] as { _id?: unknown } | undefined;
          // Лише запити про читання: запис у списку (readGet — віджет зліва), getReadFollowing,
          // списки й статистика читання. Опис, коментарі тощо не перезапитуємо.
          return !!k && typeof k === 'object' && /read/i.test(String(k._id ?? ''));
        },
      })
      .catch(() => {
        client = null; // застосунок міг перемонтуватися — наступного разу знайдемо заново
      });
  });
});
