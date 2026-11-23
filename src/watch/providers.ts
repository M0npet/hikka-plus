/*
 * Провайдери серій: Mikai і AnimeON. Тайтл знаходимо точно — за id із посилань «Перегляд» Hikka
 * (`external` у GET api.hikka.io/anime/<slug>), без пошуку за назвою.
 *
 * Mikai: GET api.mikai.me/v1/anime/<id> → result.players[] — {team{id,name,teams[{avatarUid}]}, isSubs,
 *   providers[{name: MOONANIME|ASHDI|FENIX|TORTUGA, episodes[{number, playLink}]}]}. Dawn у JSON немає.
 * AnimeON: GET /api/player/<id>/translations → {translations[{translation{id,name,isSub,studios[{avatar{preview}}]},
 *   player[{name: Moon|Ashdi|Fenix, id, episodesCount}]}]}; серії — /api/player/<id>/episodes?take&skip&playerId&translationId
 *   → {episodes[{id, episode}]}; адреса — /api/player/<episodeId>/episode → {videoUrl}.
 *   Параметр licenseAcknowledged (тайтли з ліцензією) — НЕ підставляємо.
 * Однакові плеєри однієї команди з двох сайтів дають той самий iframe — лишаємо Mikai (адреси одразу, без запиту на серію).
 */
import { getJson } from '../core/net';
import { safeFrameSrc, type PlayerKind, type WatchPlayer, type WatchTeam } from './types';

export type WatchLinks = { mikai?: { id: number; slug: string }; animeon?: number; anitube?: string };

/** id тайтлів на сайтах із посилань Hikka. */
export function parseWatchLinks(external: { url: string; type: string }[]): WatchLinks {
  const out: WatchLinks = {};
  for (const e of external) {
    if (e.type !== 'watch') continue;
    let u: URL;
    try {
      u = new URL(e.url);
    } catch {
      continue;
    }
    const host = u.host.replace(/^www\./, '');
    const mk = host === 'mikai.me' && u.pathname.match(/^\/anime\/(\d+)-([\w-]+)/);
    if (mk && !out.mikai) out.mikai = { id: Number(mk[1]), slug: mk[2]! };
    const ao = host === 'animeon.club' && u.pathname.match(/^\/anime\/(\d+)/);
    if (ao && !out.animeon) out.animeon = Number(ao[1]);
    if (host === 'anitube.in.ua' && u.protocol === 'https:' && !out.anitube) out.anitube = u.toString();
  }
  return out;
}

/** Ключ команди: назва без «Субтитри», регістру й розділових знаків + тип. */
export function teamKey(name: string, sub: boolean) {
  const n = name
    .toLowerCase()
    .replace(/субтитри|субтитрами|subs?\b/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
  return `${n || name}${sub ? ':sub' : ''}`;
}
const cleanName = (name: string) => name.replace(/^\s*субтитри\s*(\||[-—:])?\s*/i, '').trim() || name.trim();

// ---------- Mikai ----------

type MikaiAnime = {
  slug: string;
  players: {
    team?: { id: number; name: string; teams?: { avatarUid?: string | null }[] };
    isSubs: boolean;
    providers: { name: string; episodes: { number: number; playLink: string }[] }[];
  }[];
};

const MIKAI_KIND: Record<string, Exclude<PlayerKind, 'custom'>> = { MOONANIME: 'moon', ASHDI: 'ashdi', FENIX: 'fenix' };

export async function mikaiTeams(id: number, slug: string): Promise<WatchTeam[]> {
  const res = await getJson<{ ok: boolean; result: MikaiAnime }>(`https://api.mikai.me/v1/anime/${id}`);
  const a = res.result;
  const out: WatchTeam[] = [];
  for (const p of a?.players ?? []) {
    if (!p.team?.name) continue;
    const players: WatchPlayer[] = [];
    for (const pr of p.providers ?? []) {
      const kind = MIKAI_KIND[pr.name];
      if (!kind) continue; // TORTUGA прибрали (рішення MK), DAWN не вбудовується
      const byN = new Map<number, string>();
      for (const e of pr.episodes ?? []) {
        const src = safeFrameSrc(e.playLink, kind);
        if (src && Number.isFinite(e.number)) byN.set(e.number, src);
      }
      if (!byN.size) continue;
      players.push({
        id: `mikai:${kind}`,
        kind,
        site: 'mikai',
        label: '',
        noAds: kind === 'moon',
        episodes: [...byN.keys()].sort((x, y) => x - y),
        src: async (n) => byN.get(n) ?? null,
      });
    }
    if (!players.length) continue;
    const uid = p.team.teams?.find((t) => t.avatarUid)?.avatarUid;
    const teamId = p.team.id;
    const v = p.isSubs ? 'sub' : 'dub';
    out.push({
      id: teamKey(p.team.name, p.isSubs),
      name: p.team.name.trim(),
      sub: p.isSubs,
      avatar: uid && /^[\w-]+$/.test(uid) ? `https://images.mikai.me/avatar/small/${uid}.webp` : undefined,
      players,
      dawn: (ep) => `https://mikai.me/anime/${id}-${a.slug || slug}?ep=${ep}&team=${teamId}&v=${v}&p=dawn`,
    });
  }
  return out;
}

// ---------- AnimeON ----------

type AoTranslations = {
  translations: {
    translation: { id: number; name: string; isSub: boolean; studios?: { avatar?: { preview?: string } | null }[] };
    player: { name: string; id: number; episodesCount: number }[];
  }[];
};
const AO = 'https://animeon.club/api';
const AO_KIND: Record<string, Exclude<PlayerKind, 'custom'>> = { Moon: 'moon', Ashdi: 'ashdi', Fenix: 'fenix' };
/** Не українські доріжки AnimeON — не показуємо (лише українське). */
const AO_SKIP = /^(english|оригінал|original)$/i;

export async function animeonTeams(animeId: number): Promise<WatchTeam[]> {
  const d = await getJson<AoTranslations>(`${AO}/player/${animeId}/translations`);
  const out: WatchTeam[] = [];
  for (const t of d.translations ?? []) {
    const tr = t.translation;
    if (!tr?.name || AO_SKIP.test(tr.name.trim())) continue;
    const players: WatchPlayer[] = [];
    for (const pl of t.player ?? []) {
      const kind = AO_KIND[pl.name];
      if (!kind || !(pl.episodesCount > 0)) continue;
      players.push(aoPlayer(animeId, tr.id, pl.id, kind, pl.episodesCount));
    }
    if (!players.length) continue;
    const prev = tr.studios?.find((s) => s.avatar?.preview)?.avatar?.preview;
    out.push({
      id: teamKey(tr.name, tr.isSub),
      name: cleanName(tr.name),
      sub: tr.isSub,
      avatar: prev && /^[\w.-]+$/.test(prev) ? `${AO}/uploads/images/${prev}` : undefined,
      players,
    });
  }
  return out;
}

function aoPlayer(animeId: number, trId: number, playerId: number, kind: Exclude<PlayerKind, 'custom'>, count: number): WatchPlayer {
  // Список серій (id серії AnimeON за номером) — один раз на плеєр, лише коли його обрали.
  let list: Promise<Map<number, number>> | null = null;
  const load = async () => {
    const map = new Map<number, number>();
    for (let skip = 0; skip < 2000; skip += 100) {
      const q = new URLSearchParams({ take: '100', skip: String(skip), playerId: String(playerId), translationId: String(trId), includeAlternative: 'true' });
      const r = await getJson<{ episodes: { id: number; episode: number }[]; pagination?: { hasMore?: boolean } }>(
        `${AO}/player/${animeId}/episodes?${q}`,
      );
      for (const e of r.episodes ?? []) map.set(e.episode, e.id);
      if (!r.pagination?.hasMore || !r.episodes?.length) break;
    }
    return map;
  };
  return {
    id: `animeon:${kind}`,
    kind,
    site: 'animeon',
    label: '',
    noAds: kind === 'moon',
    // Точні номери — після завантаження списку; до того вважаємо 1..N.
    episodes: Array.from({ length: count }, (_, i) => i + 1),
    src: async (n) => {
      list ??= load().catch((e) => {
        list = null;
        throw e;
      });
      const epId = (await list).get(n);
      if (!epId) return null;
      const r = await getJson<{ videoUrl?: string }>(`${AO}/player/${epId}/episode`);
      return safeFrameSrc(r.videoUrl, kind);
    },
  };
}

// ---------- Злиття ----------

/** Команди з обох сайтів: однакова команда — одна; однаковий плеєр — з Mikai. Порядок: Mikai, потім нові з AnimeON. */
export function mergeTeams(mikai: WatchTeam[], animeon: WatchTeam[]): WatchTeam[] {
  const byId = new Map<string, WatchTeam>();
  for (const t of mikai) byId.set(t.id, { ...t, players: [...t.players] });
  for (const t of animeon) {
    const cur = byId.get(t.id);
    if (!cur) {
      byId.set(t.id, t);
      continue;
    }
    for (const p of t.players) if (!cur.players.some((x) => x.kind === p.kind)) cur.players.push(p);
    cur.avatar ??= t.avatar;
  }
  // Озвучки першими, субтитри — після.
  return [...byId.values()].sort((a, b) => Number(a.sub) - Number(b.sub));
}
