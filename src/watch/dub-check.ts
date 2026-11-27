/*
 * Фон: перевірка нових серій в озвучках (див. dub-alerts.ts), сповіщення браузера; число на іконці — src/core/notify.ts.
 * Будильник CHECK_EVERY_MIN (дозвіл alarms); між тайтлами пауза GAP_MS — Mikai дозволяє 300 запитів/хв, ми робимо ≤ MAX_TRACK раз на 3 год.
 */
import { browser } from '#imports';
import { hookNotes, notesApi } from '../core/notify';
import {
  CHECK_EVERY_MIN,
  dubCheckItem,
  dubsItem,
  getDubPrefs,
  mikaiTeamMax,
  pruneDubs,
  updateDubs,
  type DubCheckResult,
} from './dub-alerts';

const ALARM = 'hp-dubs';
const GAP_MS = 1500;
const TIMEOUT_MS = 20_000;
const NOTE_PREFIX = 'hp-dub:';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function onNoteClick(id: string) {
  if (!id.startsWith(NOTE_PREFIX)) return;
  const slug = id.slice(NOTE_PREFIX.length);
  const url = slug ? `https://hikka.io/anime/${encodeURIComponent(slug)}` : browser.runtime.getURL('/options.html#player');
  void browser.tabs.create({ url });
}

type Fresh = { slug: string; name: string; tn: string; n: number; added: number };

async function notify(fresh: Fresh[]) {
  const api = notesApi();
  if (!api || !fresh.length) return;
  const iconUrl = browser.runtime.getURL('/icon/128.png');
  try {
    if (fresh.length <= 3) {
      for (const f of fresh)
        await api.create(`${NOTE_PREFIX}${f.slug}`, {
          type: 'basic',
          iconUrl,
          title: f.added > 1 ? `Нові серії в озвучці: ${f.added}` : 'Нова серія в озвучці',
          message: `${f.name}\n${f.tn} · серія ${f.n}`,
        });
    } else {
      await api.create(NOTE_PREFIX, {
        type: 'basic',
        iconUrl,
        title: `Нові серії в озвучках: ${fresh.length} тайтлів`,
        message: fresh
          .slice(0, 4)
          .map((f) => `${f.name} — серія ${f.n}`)
          .join('\n'),
      });
    }
  } catch {
    /* дозвіл забрали посеред перевірки */
  }
}

async function fetchPlayer(slug: string): Promise<{ status: number; body?: unknown }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.mikai.me/public/v1/anime/hikka:${encodeURIComponent(slug)}/player`, {
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      signal: ctrl.signal,
    });
    return { status: res.status, body: res.ok ? await res.json() : undefined };
  } catch {
    return { status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

let running: Promise<DubCheckResult> | null = null;

/** Перевірити всі тайтли. force — не дивитися на час останньої перевірки (кнопка «Перевірити зараз»). */
export function checkDubs(force = false): Promise<DubCheckResult> {
  running ??= run(force).finally(() => (running = null));
  return running;
}

async function run(force: boolean): Promise<DubCheckResult> {
  const prefs = await getDubPrefs();
  if (!prefs.on) return { ok: true, found: 0 };
  const now = Date.now();
  if (!force && now - (await dubCheckItem.getValue()) < (CHECK_EVERY_MIN - 5) * 60_000) return { ok: true, found: 0 };
  await dubCheckItem.setValue(now);

  const tracked = pruneDubs(await dubsItem.getValue(), now);
  const grown = new Map<string, number>();
  let error: string | undefined;
  for (const [i, [slug, t]] of Object.entries(tracked).entries()) {
    if (i) await sleep(GAP_MS);
    const r = await fetchPlayer(slug);
    if (r.status === 429) {
      error = 'Mikai просить почекати — решту перевіримо наступного разу';
      break;
    }
    if (r.status === 0 || r.status >= 500) {
      error = 'Mikai не відповів';
      continue;
    }
    if (r.status !== 200) continue; // 404 — тайтл зник з Mikai; лишаємо, поки не застаріє
    const max = mikaiTeamMax((r.body as { result?: Parameters<typeof mikaiTeamMax>[0] })?.result, t.team);
    if (max > t.n) grown.set(slug, max);
  }

  const fresh: Fresh[] = [];
  await updateDubs((m) => {
    for (const [slug, max] of grown) {
      const t = m[slug];
      if (!t || max <= t.n) continue; // користувач щойно відкрив тайтл — уже побачив
      fresh.push({ slug, name: t.name, tn: t.tn, n: max, added: max - t.n });
      m[slug] = { ...t, n: max, nu: now };
    }
    return pruneDubs(m, now);
  });
  // Число на іконці перерахує watchBadge (src/core/notify.ts), якщо список змінився.
  if (prefs.notify) await notify(fresh);
  return { ok: !error, found: fresh.length, error };
}

/** Запуск у фоні: будильник і клік по сповіщенню (число на іконці — src/core/notify.ts, watchBadge). */
export function startDubAlerts() {
  void browser.alarms.get(ALARM).then((a) => {
    if (!a) void browser.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: CHECK_EVERY_MIN });
  });
  browser.alarms.onAlarm.addListener((a) => {
    if (a.name === ALARM) void checkDubs();
  });
  hookNotes(onNoteClick);
}
