import { useEffect, useState } from 'react';
import type { HikkaTitle } from '../core/hikka';
import { linkSourcesFor, type LinkResult } from '../sources/links';
import { IconExternal, IconSearch } from '../ui/icons';
import type { TitleState } from './title-state';
import { btn } from '../ui/kit';

type Found = { id: string; name: string; res: LinkResult };

// Кеш на час відкритої вкладки: щоб при поверненні на тайтл не шукати знову.
const cache = new Map<string, Promise<Found[]>>();

function findAll(t: HikkaTitle): Promise<Found[]> {
  const key = `${t.kind}/${t.slug}`;
  let p = cache.get(key);
  if (!p) {
    p = Promise.all(
      linkSourcesFor(t.kind).map(async (src) => {
        try {
          const res = await src.find(t);
          return res ? { id: src.id, name: src.name, res } : null;
        } catch (e) {
          console.warn('[Hikka Plus] джерело-посилання', src.id, e);
          return null;
        }
      }),
    ).then((list) => list.filter((x): x is Found => !!x));
    cache.set(key, p);
  }
  return p;
}

/** «Також є на …»: сайти, де читати можна лише в них (захищена читалка). */
export function ExternalLinks({ state: s }: { state: TitleState }) {
  const [found, setFound] = useState<Found[] | null>(null);
  const t = s.hikka;

  useEffect(() => {
    setFound(null);
    if (!t) return;
    let alive = true;
    void findAll(t).then((f) => alive && setFound(f));
    return () => {
      alive = false;
    };
  }, [t]);

  if (!found?.length) return null;
  const titles = found.filter((f) => !f.res.search);
  const searches = found.filter((f) => f.res.search);

  return (
    <div className="hp-links" aria-label="Інші сайти">
      {titles.length > 0 && <span className="hp-small hp-muted">Також є на:</span>}
      {titles.map((f) => (
        <a
          key={f.id}
          className={btn('outline', 'sm')}
          href={f.res.url}
          target="_blank"
          rel="noreferrer"
          title={`Відкрити на ${f.name}${f.res.title ? ` — ${f.res.title}` : ''}${f.res.exact ? ' (сайт сам прив’язав тайтл до Hikka)' : ''}`}
        >
          {f.name}
          {f.res.chapters && <span className="hp-muted hp-tnum">{f.res.chapters}</span>}
          <IconExternal />
        </a>
      ))}
      {/* Пошук — не гарантія, що тайтл там є, тож окремим підписом. */}
      {searches.length > 0 && <span className="hp-small hp-muted">Пошукати на:</span>}
      {searches.map((f) => (
        <a
          key={f.id}
          className={btn('outline', 'sm')}
          href={f.res.url}
          target="_blank"
          rel="noreferrer"
          title={`Шукати на ${f.name}`}
        >
          <IconSearch />
          {f.name}
        </a>
      ))}
    </div>
  );
}
