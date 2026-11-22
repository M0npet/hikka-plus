/** Нормалізація назви для порівняння: нижній регістр, лише літери й цифри. */
export function normalize(s: string): string {
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
export function similarity(a: string, b: string): number {
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
