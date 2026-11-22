import { getJson } from './net';
import type { ReadKind } from './page';

export interface HikkaExternal {
  text: string;
  type: string; // 'general' | 'read' | ...
  url: string;
}

export interface HikkaTitle {
  slug: string;
  kind: ReadKind;
  title_ua: string | null;
  title_en: string | null;
  title_original: string | null;
  title_native?: string | null;
  synonyms: string[];
  media_type: string | null; // manga, manhwa, manhua, one_shot, novel, light_novel…
  year: number | null;
  chapters: number | null;
  external: HikkaExternal[];
  mal_id: number | null;
}

const cache = new Map<string, Promise<HikkaTitle>>();

export function fetchHikkaTitle(kind: ReadKind, slug: string): Promise<HikkaTitle> {
  const key = `${kind}/${slug}`;
  let p = cache.get(key);
  if (!p) {
    p = getJson<Omit<HikkaTitle, 'kind'>>(`https://api.hikka.io/${kind}/${slug}`).then((d) => ({
      ...d,
      kind,
      synonyms: d.synonyms ?? [],
      external: d.external ?? [],
    }));
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** Усі відомі назви тайтлу, без дублікатів, найважливіші першими. */
export function titleNames(t: HikkaTitle): string[] {
  const all = [t.title_ua, t.title_en, t.title_original, t.title_native, ...t.synonyms];
  return [...new Set(all.filter((x): x is string => !!x && x.trim().length > 0))];
}
