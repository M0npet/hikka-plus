/** Ключ команди: назва без «Субтитри», регістру й розділових знаків + тип. Окремо — щоб фон (dub-check.ts) не тягнув providers. */
export function teamKey(name: string, sub: boolean) {
  const n = name
    .toLowerCase()
    .replace(/субтитри|субтитрами|subs?\b/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
  return `${n || name}${sub ? ':sub' : ''}`;
}
