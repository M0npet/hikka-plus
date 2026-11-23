export type ReadKind = 'manga' | 'novel';

export interface TitlePage {
  kind: ReadKind;
  slug: string;
}

/** Головна сторінка тайтлу манґи/ранобе: /manga/<slug> або /novel/<slug>. */
export function parseTitlePage(url: string = location.href): TitlePage | null {
  const m = new URL(url).pathname.match(/^\/(manga|novel)\/([\w-]+)\/?$/);
  return m?.[1] && m[2] ? { kind: m[1] as ReadKind, slug: m[2] } : null;
}

/** Сторінка аніме: /anime/<slug>. */
export function parseAnimePage(url: string = location.href): { slug: string } | null {
  const m = new URL(url).pathname.match(/^\/anime\/([\w-]+)\/?$/);
  return m?.[1] ? { slug: m[1] } : null;
}
