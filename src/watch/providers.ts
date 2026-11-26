/*
 * Провайдери серій: Mikai і AnimeON. Тайтл знаходимо точно — за id із посилань «Перегляд» Hikka
 * (`external` у GET api.hikka.io/anime/<slug>), без пошуку за назвою.
 *
 * Mikai (0.6.1, публічний API — Mikai дозволили користуватись, MK 2026-11-24 21:08; https://api.mikai.me/public/docs):
 *   GET api.mikai.me/public/v1/anime/hikka:<slug>/player → result {anime{ids{mikai, slug, hikka}}, licensed,
 *   releases[{id: "t_<team>:voice|sub", kind: voice|sub, teams[{id, name, avatar{small{webp}}}], episodes[{number,
 *   sources[{provider: moon|ashdi|fenix|tortuga, embedUrl}]}]}]}. Тайтл — за slug Hikka (посилання на Mikai в Hikka не потрібне);
 *   не знайшли, а посилання є — за id Mikai. Кеш — HTTP-кеш браузера (Cache-Control: public, max-age=300).
 *   Запасний шлях — старий внутрішній GET api.mikai.me/v1/anime/<id> (players[].providers[]). Dawn у JSON немає.
 * AnimeON: GET /api/player/<id>/translations → {translations[{translation{id,name,isSub,studios[{avatar{preview}}]},
 *   player[{name: Moon|Ashdi|Fenix, id, episodesCount}]}]}; серії — /api/player/<id>/episodes?take&skip&playerId&translationId
 *   → {episodes[{id, episode}]}; адреса — /api/player/<episodeId>/episode → {videoUrl}.
 *   Параметр licenseAcknowledged (тайтли з ліцензією) — НЕ підставляємо.
 * Однакові плеєри однієї команди з двох сайтів дають той самий iframe — лишаємо Mikai (адреси одразу, без запиту на серію).
 */
import { getJson } from '../core/net';
import { teamKey } from './team-key';

export { teamKey };
import { safeFrameSrc, type PlayerKind, type WatchPlayer, type WatchTeam } from './types';

type WatchLinks = { mikai?: { id: number; slug: string }; animeon?: number };

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
  }
  return out;
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

type MikaiRelease = {
  id?: string;
  kind?: string;
  teams?: { id: number; name: string; avatar?: { small?: { webp?: string } } | null }[];
  episodes?: { number: number; sources?: { provider: string; embedUrl: string }[] }[];
};
type MikaiPlayer = {
  anime?: { ids?: { mikai?: number; slug?: string } };
  licensed?: boolean;
  /** Українська ліцензія (є й при licensed:false; перевірено 2026-11-25): {licensedBy, link, uaDub?, uaSubs?}. */
  license?: { licensedBy?: unknown; link?: unknown; uaDub?: unknown; uaSubs?: unknown };
  releases?: MikaiRelease[];
};

/** Де тайтл можна дивитися легально в Україні (блок license з Mikai). dub/subs — undefined, якщо Mikai не перевіряв. */
export type UaLicense = { by: string; link?: string; dub?: boolean; subs?: boolean };

function parseLicense(l: MikaiPlayer['license']): UaLicense | undefined {
  if (!l || typeof l.licensedBy !== 'string' || !l.licensedBy.trim()) return undefined;
  let link: string | undefined;
  try {
    const u = typeof l.link === 'string' ? new URL(l.link) : null;
    if (u?.protocol === 'https:') link = u.href;
  } catch {
    /* немає */
  }
  return {
    by: l.licensedBy.trim().slice(0, 60),
    link,
    dub: typeof l.uaDub === 'boolean' ? l.uaDub : undefined,
    subs: typeof l.uaSubs === 'boolean' ? l.uaSubs : undefined,
  };
}

type MikaiResult = { teams: WatchTeam[]; license?: UaLicense };

const PUB_KIND: Record<string, Exclude<PlayerKind, 'custom'>> = { moon: 'moon', ashdi: 'ashdi', fenix: 'fenix' };

/** Команди з публічного API Mikai. null — тайтлу немає на Mikai (404). */
async function mikaiPublic(ref: string): Promise<MikaiResult | null> {
  let res: { ok?: boolean; result?: MikaiPlayer };
  try {
    res = await getJson(`https://api.mikai.me/public/v1/anime/${ref}/player`);
  } catch (e) {
    if ((e as { status?: number })?.status === 404) return null;
    throw e;
  }
  const r = res.result;
  const license = parseLicense(r?.license);
  // Ліцензований тайтл: плеєра немає — показуємо лише блок license (де дивитися легально), як просить Mikai.
  if (!r || r.licensed) return { teams: [], license };
  const out: WatchTeam[] = [];
  for (const rel of r.releases ?? []) {
    const teams = (rel.teams ?? []).filter((t) => t?.name);
    if (!teams.length) continue;
    const sub = rel.kind === 'sub';
    const byKind = new Map<Exclude<PlayerKind, 'custom'>, Map<number, string>>();
    for (const ep of rel.episodes ?? []) {
      if (!Number.isFinite(ep.number)) continue;
      for (const s of ep.sources ?? []) {
        const kind = PUB_KIND[s.provider];
        if (!kind) continue; // tortuga прибрали (рішення MK)
        const src = safeFrameSrc(s.embedUrl, kind);
        if (!src) continue;
        if (!byKind.has(kind)) byKind.set(kind, new Map());
        if (!byKind.get(kind)!.has(ep.number)) byKind.get(kind)!.set(ep.number, src);
      }
    }
    const players: WatchPlayer[] = [];
    for (const kind of ['moon', 'ashdi', 'fenix'] as const) {
      const byN = byKind.get(kind);
      if (!byN?.size) continue;
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
    const name = teams.map((t) => t.name.trim()).join(' & ');
    const avatar = teams.find((t) => t.avatar?.small?.webp)?.avatar?.small?.webp;
    out.push({
      id: teamKey(name, sub),
      name,
      sub,
      avatar: avatar && /^https:\/\/images\.mikai\.me\//.test(avatar) ? avatar : undefined,
      players,
    });
  }
  return { teams: out, license };
}

/**
 * Команди Mikai для тайтлу Hikka: публічний API за slug Hikka → за id Mikai з посилання → старий внутрішній /v1.
 * link — посилання «Перегляд» на Mikai з Hikka (може не бути).
 */
export async function mikaiTeamsFor(hikkaSlug: string, link?: { id: number; slug: string }): Promise<MikaiResult> {
  try {
    const bySlug = await mikaiPublic(`hikka:${encodeURIComponent(hikkaSlug)}`);
    if (bySlug) return bySlug;
    if (!link) return { teams: [] };
    const byId = await mikaiPublic(String(link.id));
    if (byId) return byId;
  } catch {
    /* публічний API не відповів — пробуємо старий */
  }
  return { teams: link ? await mikaiTeams(link.id) : [] };
}

async function mikaiTeams(id: number): Promise<WatchTeam[]> {
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
    out.push({
      id: teamKey(p.team.name, p.isSubs),
      name: p.team.name.trim(),
      sub: p.isSubs,
      avatar: uid && /^[\w-]+$/.test(uid) ? `https://images.mikai.me/avatar/small/${uid}.webp` : undefined,
      players,
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
