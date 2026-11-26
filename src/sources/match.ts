import { titleNames, type HikkaTitle } from '../core/hikka';
import { rethrowRateLimit } from '../core/net';
import type { RemoteTitle } from './types';
import { kovalenko } from './kovalenko';
/** Нормалізація назви для порівняння: нижній регістр, лише літери й цифри. */
function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .toLocaleLowerCase('uk-UA')
    .replace(/[ʼ'’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function words(s: string): Set<string> {
  return new Set(normalize(s).split(' ').filter(Boolean));
}

/** Схожість двох назв 0..1 (1 — збіг після нормалізації). */
function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const wa = words(a);
  const wb = words(b);
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  const jaccard = common / (wa.size + wb.size - common);
  const contains = na.includes(nb) || nb.includes(na) ? 0.85 : 0;
  return Math.max(jaccard, contains * Math.min(na.length, nb.length) / Math.max(na.length, nb.length) + 0.1);
}

/** Найкращий збіг між будь-якою назвою з одного списку та будь-якою з іншого. */
export function bestSimilarity(a: string[], b: string[]): number {
  let best = 0;
  for (const x of a) for (const y of b) best = Math.max(best, similarity(x, y));
  return Math.min(best, 1);
}

/** Поріг автопідбору й нижня межа для підказки «Схоже». */
const MATCH_MIN = 0.8;
const NEAR_MIN = 0.45;
/** Збіг «точно»: для постера з джерела (src/cards/covers.ts) — назва майже така сама. */
export const EXACT_MIN = 0.95;

/** Позначити тайтл, знайдений за посиланням з Hikka, як точний. */
export const exactly = (t: RemoteTitle): RemoteTitle => ({ ...t, exact: true });

// Найкращий кандидат, що не дотягнув до автопідбору: джерело → тайтл Hikka → кандидат.
const nearMisses = new WeakMap<object, Map<string, RemoteTitle>>();

/**
 * Підсумок автопідбору: ≥ `min` — знайдено; інакше кандидат ≥ NEAR_MIN запам'ятовується
 * для підказки «Схоже» (забрати — `takeNearMiss`). Прив'язується він лише по кліку.
 */
export function settleMatch(
  src: object,
  title: HikkaTitle,
  best: { t: RemoteTitle; score: number } | null,
  min = MATCH_MIN,
): RemoteTitle | null {
  if (best && best.score >= min) return { ...best.t, exact: best.score >= EXACT_MIN };
  if (best && best.score >= NEAR_MIN) {
    let m = nearMisses.get(src);
    if (!m) nearMisses.set(src, (m = new Map()));
    m.set(`${title.kind}:${title.slug}`, best.t);
  }
  return null;
}

export function takeNearMiss(src: object, title: HikkaTitle): RemoteTitle | null {
  const m = nearMisses.get(src);
  const key = `${title.kind}:${title.slug}`;
  const t = m?.get(key) ?? null;
  m?.delete(key);
  return t;
}

/**
 * Типовий автопідбір: спершу посилання на джерело в блоці «Читати» на Hikka,
 * потім пошук за кількома назвами й вибір найсхожішої (≥ 0.8).
 */
export async function autoMatchBy(
  src: {
    search(q: string, kind: HikkaTitle['kind']): Promise<RemoteTitle[]>;
    getTitle(id: string): Promise<RemoteTitle>;
  },
  title: HikkaTitle,
  linkRe?: RegExp,
): Promise<RemoteTitle | null> {
  if (linkRe) {
    for (const ext of title.external) {
      const m = ext.url.match(linkRe);
      if (m?.[1]) {
        try {
          return exactly(await src.getTitle(decodeURIComponent(m[1])));
        } catch (e) {
          rethrowRateLimit(e); // 429 — сайт просить почекати, а не «посилання застаріло»
          /* посилання застаріло — шукаємо за назвою */
        }
      }
    }
  }
  const hikkaNames = titleNames(title);
  // Укр. сайти шукають переважно за українською назвою, а вона в Hikka буває й лише в синонімах
  // («Коли я переродився слизом» при основній «Про моє переродження в слиз») — тож спершу всі
  // кириличні назви (до 3), потім англійська й оригінальна.
  const cyr = hikkaNames.filter((n) => /[а-яіїєґ]/i.test(n));
  // Латиниця — англійська, ромадзі й латинські синоніми (до 3); японська/китайська назва укр. сайтам не допоможе.
  const latin = hikkaNames.filter((n) => !cyr.includes(n) && /[a-z]/i.test(n));
  const queries = [...cyr.slice(0, 3), ...latin.slice(0, 3)];
  // Транслітерація ромадзі за Коваленком (kovalenko.ts): багато тайтлів на укр. сайтах названо так («Шінґекі но Кьоджін»).
  // Порівнюємо й з нею; шукаємо нею — лише якщо звичайні назви не дали збігу (як і частини назви нижче).
  const translit = [...new Set(latin.map(kovalenko).filter((x): x is string => !!x && !cyr.includes(x)))].slice(0, 2);
  const names = [...hikkaNames, ...translit];
  // Запасні запити — частина назви: пошук деяких сайтів (NovelHub) шукає фразу цілком, тож інший
  // переклад («Сходження Героя щита» ↔ «Становлення Героя Щита») знаходиться лише за «Героя щита».
  // Ідуть, лише якщо повні назви не дали навіть кандидата для «Схоже».
  // З усіх кириличних назв, бо синоніми бувають іншим перекладом («Приборкувач звірів…» ↔ «Повелитель звірів…»).
  const partial = [
    ...new Set(
      cyr.slice(0, 3).flatMap((n) => {
        const w = n.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ');
        return w.length >= 3 ? [w.slice(-2).join(' '), w.slice(0, 2).join(' ')] : [];
      }),
    ),
  ].filter((q) => !queries.includes(q) && !translit.includes(q));
  let best: { t: RemoteTitle; score: number } | null = null;
  for (const q of [...queries, ...translit, ...partial]) {
    if (translit.includes(q) && ((best as { score: number } | null)?.score ?? 0) >= MATCH_MIN) break;
    if (partial.includes(q) && ((best as { score: number } | null)?.score ?? 0) >= NEAR_MIN) break;
    let found: RemoteTitle[];
    // Без розділових знаків: пошук деяких сайтів (Honey) нічого не знаходить за «I'm the …».
    const query = q.replace(/[^\p{L}\p{N}]+/gu, ' ').trim() || q;
    try {
      found = await src.search(query, title.kind);
    } catch (e) {
      rethrowRateLimit(e); // далі не шукаємо: решта запитів лише продовжить паузу
      continue;
    }
    for (const t of found.slice(0, 10)) {
      let score = bestSimilarity([t.title, ...t.altTitles], names);
      if (title.year && t.year && Math.abs(title.year - t.year) > 1) score -= 0.15;
      if (!best || score > best.score) best = { t, score };
    }
    if (best && best.score >= 0.98) break;
  }
  return settleMatch(src, title, best);
}

/** Номер розділу для сортування. */
export const chapterNum = (s: string | null | undefined) =>
  s == null ? 0 : Number.parseFloat(String(s).replace(',', '.')) || 0;
