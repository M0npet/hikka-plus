/*
 * «Далі з Дивлюсь» (MK 2026-11-26 17:44, вимикач WatchPrefs.upNext): на останній серії тайтлу, у якого немає наступного
 * сезону, — кнопка поверх плеєра на інший тайтл зі списку «Дивлюсь» того, хто зайшов на Hikka.
 * API (бекенд hikka-io/hikka, app/watch/router.py, перевірено 2026-11-26): POST api.hikka.io/watch/{username}/list?page&size,
 * тіло {watch_status, sort} → {pagination, list: [{episodes, status, anime: {slug, title_ua/en/ja, episodes_released,
 * episodes_total}}]} — публічний список, без входу. Ім'я — з кешу сторінки Hikka (hikkaMeItem, src/core/title-lang.ts).
 * Беремо найсвіжіше оновлений тайтл, де вийшли ще не переглянуті серії. Без React.
 */
import { postJson } from '../core/net';

export type UpNext = { slug: string; title: [string, string, string]; ep: number };

type Row = {
  episodes?: unknown;
  anime?: { slug?: unknown; title_ua?: unknown; title_en?: unknown; title_ja?: unknown; episodes_released?: unknown; episodes_total?: unknown };
};

const TTL_MS = 10 * 60_000;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const cache = new Map<string, { at: number; p: Promise<Row[]> }>();

function watching(user: string): Promise<Row[]> {
  const hit = cache.get(user);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p;
  const p = postJson<{ list?: Row[] }>(`https://api.hikka.io/watch/${encodeURIComponent(user)}/list?page=1&size=30`, {
    watch_status: 'watching',
    sort: ['watch_updated:desc'],
  })
    .then((r) => (Array.isArray(r.list) ? r.list : []))
    .catch(() => {
      cache.delete(user); // помилка — спробувати наступного разу
      return [] as Row[];
    });
  cache.set(user, { at: Date.now(), p });
  return p;
}

/** Наступний тайтл зі списку «Дивлюсь» (не поточний), де є вийшла й не переглянута серія; null — немає. */
export async function getUpNext(user: string, current: string): Promise<UpNext | null> {
  if (!user) return null;
  for (const r of await watching(user)) {
    const a = r.anime;
    const slug = str(a?.slug);
    if (!slug || slug === current) continue;
    const seen = int(r.episodes);
    const out = int(a?.episodes_released) || int(a?.episodes_total);
    if (out <= seen) continue;
    return { slug, title: [str(a?.title_ua), str(a?.title_en), str(a?.title_ja)], ep: seen + 1 };
  }
  return null;
}
