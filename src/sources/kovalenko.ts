/*
 * Ромадзі → кирилиця за системою Коваленка (MK 2026-11-26 14:03, ідея 5 з research-hikka-github.md): запасний
 * пошук на українських сайтах, де тайтл названо транслітом японської назви («Шінґекі но Кьоджін»).
 * Таблиця складів і правила (і після голосної → ї/й, е після і → є, н перед m/b/p → м; довгі ou/uu — одна літера) — з hikka-io/jp-transliteration
 * (MIT © 2024 Oleh Nykoliak, lib/constants.ts, lib/convert.ts); кандзі/кана не перетворюємо (kuroshiro не тягнемо).
 * Слово з літерами, яких у ромадзі не буває (l, v, x, q, c без h…), — не японське: тоді транслітерації немає (null),
 * щоб не псувати англійські назви.
 */
const SYL: Record<string, string> = {
  a: 'а', i: 'і', u: 'у', e: 'е', o: 'о',
  ka: 'ка', ki: 'кі', ku: 'ку', ke: 'ке', ko: 'ко',
  ga: 'ґа', gi: 'ґі', gu: 'ґу', ge: 'ґе', go: 'ґо',
  sa: 'са', shi: 'ші', su: 'су', se: 'се', so: 'со', si: 'ші',
  za: 'дза', ji: 'джі', zu: 'дзу', ze: 'дзе', zo: 'дзо', zi: 'джі',
  ta: 'та', chi: 'чі', tsu: 'цу', te: 'те', to: 'то', ti: 'чі', tu: 'цу',
  da: 'да', di: 'джі', du: 'дзу', de: 'де', do: 'до',
  na: 'на', ni: 'ні', nu: 'ну', ne: 'не', no: 'но',
  ha: 'ха', hi: 'хі', fu: 'фу', he: 'хе', ho: 'хо', hu: 'фу',
  ba: 'ба', bi: 'бі', bu: 'бу', be: 'бе', bo: 'бо',
  pa: 'па', pi: 'пі', pu: 'пу', pe: 'пе', po: 'по',
  ma: 'ма', mi: 'мі', mu: 'му', me: 'ме', mo: 'мо',
  ya: 'я', yu: 'ю', yo: 'йо', ye: 'є',
  ra: 'ра', ri: 'рі', ru: 'ру', re: 'ре', ro: 'ро',
  wa: 'ва', wo: 'о', wi: 'ві', we: 'ве',
  n: 'н',
  kya: 'кя', kyu: 'кю', kyo: 'кьо', gya: 'ґя', gyu: 'ґю', gyo: 'ґьо',
  sha: 'шя', shu: 'шю', sho: 'шьо', she: 'ше', ja: 'джя', ju: 'джю', jo: 'джьо', je: 'дже',
  cha: 'чя', chu: 'чю', cho: 'чьо', che: 'че', nya: 'ня', nyu: 'ню', nyo: 'ньо',
  hya: 'хя', hyu: 'хю', hyo: 'хьо', bya: 'бя', byu: 'бю', byo: 'бьо',
  pya: 'пя', pyu: 'пю', pyo: 'пьо', mya: 'мя', myu: 'мю', myo: 'мьо', rya: 'ря', ryu: 'рю', ryo: 'рьо',
  // Складів-запозичень у ромадзі тайтлів чимало (Frieren, Fate, Vinland — ні: v).
  fa: 'фа', fi: 'фі', fe: 'фе', fo: 'фо', tsa: 'ца', tse: 'це', tso: 'цо', dza: 'дза',
};
const VOWELS = 'aiueo';
/** Подвоєна приголосна (kk, ss, tt, pp, tch) — сама літера. */
const GEM: Record<string, string> = { k: 'к', s: 'с', t: 'т', p: 'п', g: 'ґ', d: 'д', b: 'б', m: 'м', r: 'р', f: 'ф', z: 'з', h: 'х', j: 'д' };
const MACRON: Record<string, string> = { ā: 'a', ī: 'i', ū: 'u', ē: 'e', ō: 'o', â: 'a', î: 'i', û: 'u', ê: 'e', ô: 'o' };

/** Одне слово з латинських літер; null — не схоже на ромадзі. */
function word(w: string): string | null {
  const s = w.toLowerCase().replace(/[āīūēōâîûêô]/g, (c) => MACRON[c]!).replace(/'/g, '');
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    const prev = s[i - 1] ?? '';
    // Подвоєна приголосна / «tch» → літера + далі склад.
    if ((c === s[i + 1] && c !== 'n' && GEM[c]) || (c === 't' && s.startsWith('ch', i + 1))) {
      out += GEM[c]!;
      i++;
      continue;
    }
    let hit = '';
    for (let len = 3; len > 0 && !hit; len--) if (SYL[s.slice(i, i + len)] !== undefined) hit = s.slice(i, i + len);
    if (!hit) return null;
    // Довгі «ou», «uu» — однією літерою («Шьокудо», «Ґакко»), як ō/ū.
    if (hit === 'u' && (prev === 'o' || prev === 'u')) out += '';
    else if (hit === 'i' && VOWELS.includes(prev) && prev) out += i + 1 === s.length ? 'й' : 'ї';
    else if (hit === 'e' && prev === 'i') out += 'є';
    else if (hit === 'n' && 'mbp'.includes(s[i + 1] ?? '_')) out += 'м';
    else out += SYL[hit];
    i += hit.length;
  }
  return out;
}

/** Назва ромадзі → кирилиця за Коваленком; null — назва не японська (або вже кирилична). */
export function kovalenko(name: string): string | null {
  if (!/[a-z]/i.test(name) || /[а-яіїєґ]/i.test(name)) return null;
  let changed = false;
  let bad = false;
  const res = name.replace(/[a-zA-Zāīūēōâîûêô']+/g, (w) => {
    const k = word(w);
    if (k == null) {
      bad = true;
      return w;
    }
    changed = true;
    return w[0] === w[0]!.toUpperCase() ? k[0]!.toUpperCase() + k.slice(1) : k;
  });
  return changed && !bad ? res : null;
}
