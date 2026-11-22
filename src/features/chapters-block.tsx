import { useEffect, useMemo, useState } from 'react';
import { titleNames } from '../core/hikka';
import { sourcesFor } from '../sources/registry';
import type { Chapter, ReadSource, RemoteTitle } from '../sources/types';
import { IconCheck, IconExternal, IconLink, IconSearch, IconSort } from '../ui/icons';
import { bindManually, openReader, useTitleState, type TitleState } from './title-state';

const dateFmt = new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: '2-digit', year: '2-digit' });

/** Блок «Розділи» в центральній колонці сторінки тайтлу. */
export function ChaptersBlock() {
  const s = useTitleState();
  const [binding, setBinding] = useState(false);
  if (!s) return null;

  const showSearch = binding || s.status === 'not-found';

  return (
    <section className="hp-block" aria-label="Розділи (Hikka Plus)">
      <div className="hp-block__head">
        <h3 className="hp-block__title">Розділи</h3>
        {s.chapters.length > 0 && <span className="hp-badge">{s.chapters.length}</span>}
        <span className="hp-grow" />
        {s.source && s.remote && (
          <a
            className="hp-btn hp-btn--ghost hp-small"
            href={s.remote.url || undefined}
            target="_blank"
            rel="noreferrer"
            title={`${s.remote.title} на ${s.source.name}`}
          >
            {s.source.name}
            <IconExternal />
          </a>
        )}
        {s.status !== 'loading' && (
          <button
            type="button"
            className="hp-btn hp-btn--ghost hp-small"
            onClick={() => setBinding((v) => !v)}
            title="Знайти тайтл на джерелі вручну"
          >
            <IconLink />
            {binding ? 'Скасувати' : s.remote ? 'Змінити' : 'Знайти'}
          </button>
        )}
      </div>

      {showSearch && <BindSearch state={s} onDone={() => setBinding(false)} />}

      {!showSearch && s.status === 'loading' && (
        <div className="hp-card">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="hp-skeleton" />
          ))}
        </div>
      )}
      {!showSearch && s.status === 'error' && <div className="hp-card hp-state">{s.error}</div>}
      {!showSearch && s.status === 'ready' && <ChapterList state={s} />}
    </section>
  );
}

function ChapterList({ state: s }: { state: TitleState }) {
  const [query, setQuery] = useState('');
  const [team, setTeam] = useState('');
  const [desc, setDesc] = useState(false);

  const teams = useMemo(
    () => [...new Set(s.chapters.map((c) => c.team).filter((t): t is string => !!t))],
    [s.chapters],
  );
  const progressMatches = s.progress?.sourceId === s.source?.id && s.progress?.remoteId === s.remote?.id;
  const read = new Set(progressMatches ? s.progress!.read : []);
  const current = progressMatches ? s.progress!.chapterId : '';

  const shown = useMemo(() => {
    const q = query.trim().replace(',', '.');
    let list = s.chapters.filter(
      (c) =>
        (!team || c.team === team) &&
        (!q || c.number.startsWith(q) || (c.name ?? '').toLowerCase().includes(q.toLowerCase())),
    );
    if (desc) list = [...list].reverse();
    return list;
  }, [s.chapters, query, team, desc]);

  if (!s.chapters.length) return <div className="hp-card hp-state">Розділів поки немає.</div>;

  const hasVolumes = s.chapters.some((c) => c.volume);
  let lastVol: string | null | undefined;

  return (
    <>
      <div className="hp-toolbar">
        <label className="hp-row hp-grow" style={{ position: 'relative' }}>
          <IconSearch style={{ position: 'absolute', left: 10, opacity: 0.6 }} />
          <input
            className="hp-input hp-grow"
            style={{ paddingLeft: 34 }}
            placeholder="Номер або назва розділу"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {teams.length > 1 && (
          <select className="hp-select" value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">Усі команди</option>
            {teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className="hp-btn hp-btn--icon"
          title={desc ? 'Спочатку перші' : 'Спочатку нові'}
          aria-pressed={desc}
          onClick={() => setDesc((v) => !v)}
        >
          <IconSort />
        </button>
      </div>

      <div className="hp-card hp-list" role="list">
        {shown.length === 0 && <div className="hp-state">Нічого не знайдено.</div>}
        {shown.map((c) => {
          const volHead = hasVolumes && c.volume !== lastVol;
          lastVol = c.volume;
          return (
            <div key={c.id} role="listitem">
              {volHead && <div className="hp-vol">Том {c.volume ?? '—'}</div>}
              <ChapterRow chapter={c} read={read.has(c.id)} current={c.id === current} />
            </div>
          );
        })}
      </div>
    </>
  );
}

function ChapterRow({ chapter: c, read, current }: { chapter: Chapter; read: boolean; current: boolean }) {
  const cls = ['hp-ch', read && 'hp-ch--read', current && 'hp-ch--current'].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} onClick={() => openReader(c.id, current)}>
      {current ? <span className="hp-dot" title="Зупинились тут" /> : read ? <IconCheck /> : <span style={{ width: 18 }} />}
      <span className="hp-grow hp-ellipsis hp-ch__title">
        Розділ {c.number}
        {c.name ? <span className="hp-muted"> — {c.name}</span> : null}
      </span>
      {c.team && <span className="hp-ch__meta hp-ellipsis" style={{ maxWidth: 140 }}>{c.team}</span>}
      {c.date && <span className="hp-ch__meta">{dateFmt.format(c.date)}</span>}
    </button>
  );
}

function BindSearch({ state: s, onDone }: { state: TitleState; onDone: () => void }) {
  const sources = sourcesFor(s.page.kind);
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '');
  const [query, setQuery] = useState(() => (s.hikka ? titleNames(s.hikka)[0] ?? '' : ''));
  const [results, setResults] = useState<RemoteTitle[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const source = sources.find((x) => x.id === sourceId) as ReadSource | undefined;

  const run = async () => {
    if (!source || !query.trim()) return;
    setBusy(true);
    setErr('');
    try {
      setResults(await source.search(query, s.page.kind));
    } catch (e) {
      setErr(String(e));
      setResults(null);
    } finally {
      setBusy(false);
    }
  };

  // Одразу шукаємо за назвою з Hikka.
  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId]);

  return (
    <div className="hp-card" style={{ padding: 12 }}>
      {s.status === 'not-found' && (
        <p className="hp-small hp-muted" style={{ margin: '0 0 10px' }}>
          Автоматично не знайшов цей тайтл на українських джерелах. Знайди його вручну — прив'язка запам'ятається.
        </p>
      )}
      <form
        className="hp-row"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        {sources.length > 1 && (
          <select className="hp-select" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            {sources.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        )}
        <input className="hp-input hp-grow" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="submit" className="hp-btn" disabled={busy}>
          {busy ? 'Шукаю…' : 'Шукати'}
        </button>
      </form>
      {err && <div className="hp-state">{err}</div>}
      {results && results.length === 0 && <div className="hp-state">Нічого не знайдено на {source?.name}.</div>}
      {results && results.length > 0 && (
        <div className="hp-results" style={{ marginTop: 8 }}>
          {results.slice(0, 12).map((r) => (
            <button
              key={r.id}
              type="button"
              className="hp-result"
              onClick={async () => {
                if (!source) return;
                await bindManually(source, r);
                onDone();
              }}
            >
              {r.cover ? <img src={r.cover} alt="" loading="lazy" /> : <span style={{ width: 40 }} />}
              <span className="hp-grow">
                <span className="hp-ellipsis" style={{ display: 'block', fontWeight: 500, fontSize: 14 }}>
                  {r.title}
                </span>
                <span className="hp-ellipsis hp-small hp-muted" style={{ display: 'block' }}>
                  {[r.altTitles[0], r.year, r.chapterCount != null ? `${r.chapterCount} розд.` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
