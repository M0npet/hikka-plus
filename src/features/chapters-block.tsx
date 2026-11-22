import { useEffect, useMemo, useState } from 'react';
import { titleNames } from '../core/hikka';
import { chapterKey } from '../core/store';
import { getSource, sourcesFor } from '../sources/registry';
import type { Chapter, ReadSource, RemoteTitle } from '../sources/types';
import { IconExternal, IconLink, IconSearch, IconSort } from '../ui/icons';
import { openReader } from './reader-url';
import {
  activeSource,
  activeState,
  activeTeam,
  bindManually,
  continueTarget,
  overallStatus,
  setActiveSource,
  setChapterRead,
  setTeam,
  titleProgress,
  useTitleState,
  visibleChapters,
  type TitleState,
} from './title-state';

const dateFmt = new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: '2-digit', year: '2-digit' });

/** Блок «Розділи» в центральній колонці сторінки тайтлу. */
export function ChaptersBlock() {
  const s = useTitleState();
  const [binding, setBinding] = useState<string | null>(null); // id джерела для ручного пошуку
  if (!s) return null;

  const status = overallStatus(s);
  const src = activeSource(s);
  const act = activeState(s);
  const searchFor = binding ?? (status === 'not-found' ? (sourcesFor(s.page.kind)[0]?.id ?? null) : null);

  return (
    <section className="hp-block" aria-label="Розділи (Hikka Plus)">
      <div className="hp-block__head">
        <h3 className="hp-block__title">Розділи</h3>
        <span className="hp-grow" />
        {src && act?.remote?.url && (
          <a
            className="hp-btn hp-btn--ghost hp-small"
            href={act.remote.url}
            target="_blank"
            rel="noreferrer"
            title={`${act.remote.title} на ${src.name}`}
          >
            {src.name}
            <IconExternal />
          </a>
        )}
        <button
          type="button"
          className="hp-btn hp-btn--ghost hp-small"
          onClick={() => setBinding(searchFor ? null : (s.activeId ?? sourcesFor(s.page.kind)[0]?.id ?? null))}
          title="Знайти тайтл на джерелі вручну"
        >
          <IconLink />
          {searchFor && binding ? 'Скасувати' : 'Знайти вручну'}
        </button>
      </div>

      <SourceSwitcher state={s} onSearch={(id) => setBinding(id)} />

      {searchFor && <BindSearch key={searchFor} state={s} sourceId={searchFor} onDone={() => setBinding(null)} />}

      {!searchFor && status === 'loading' && (
        <div className="hp-card">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="hp-skeleton" />
          ))}
        </div>
      )}
      {!searchFor && status === 'error' && (
        <div className="hp-card hp-state">{s.hikkaError ?? act?.error ?? 'Помилка завантаження'}</div>
      )}
      {!searchFor && status === 'ready' && <ChapterList state={s} />}
    </section>
  );
}

/** Перемикач джерел: назва + кількість розділів або статус пошуку. */
function SourceSwitcher({ state: s, onSearch }: { state: TitleState; onSearch: (id: string) => void }) {
  const list = sourcesFor(s.page.kind);
  return (
    <div className="hp-sources" role="group" aria-label="Джерело">
      {list.map((src) => {
        const st = s.sources[src.id];
        const found = st && st.status !== 'not-found' && st.status !== 'searching';
        const info = !st
          ? ''
          : st.status === 'searching'
            ? 'шукаю…'
            : st.status === 'loading'
              ? '…'
              : st.status === 'not-found'
                ? 'немає'
                : st.status === 'error'
                  ? 'помилка'
                  : `${new Set(st.chapters.map((c) => chapterKey(c.number))).size}`;
        return (
          <button
            key={src.id}
            type="button"
            className={`hp-src ${found ? '' : 'hp-src--off'}`}
            aria-pressed={s.activeId === src.id}
            title={found ? `Читати з ${src.name}` : `Шукати на ${src.name} вручну`}
            onClick={() => (found ? void setActiveSource(src.id) : onSearch(src.id))}
          >
            {src.name}
            {info && <small>{info}</small>}
          </button>
        );
      })}
    </div>
  );
}

function ChapterList({ state: s }: { state: TitleState }) {
  const [query, setQuery] = useState('');
  const [desc, setDesc] = useState(false);
  const all = activeState(s)?.chapters ?? [];
  const team = activeTeam(s);
  const chapters = visibleChapters(s);

  const teams = useMemo(
    () => [...new Set(all.map((c) => c.team).filter((t): t is string => !!t))],
    [all],
  );

  const shown = useMemo(() => {
    const q = query.trim().replace(',', '.').toLowerCase();
    let list = chapters.filter(
      (c) => !q || c.number.startsWith(q) || (c.name ?? '').toLowerCase().includes(q),
    );
    if (desc) list = [...list].reverse();
    return list;
  }, [chapters, query, desc]);

  const { read, total } = titleProgress(s);
  const pct = total ? Math.round((read / total) * 100) : 0;
  const target = continueTarget(s);
  const lastKey = s.progress.last?.key;

  if (!all.length) return <div className="hp-card hp-state">Розділів поки немає.</div>;

  const hasVolumes = chapters.some((c) => c.volume);
  let lastVol: string | null | undefined;

  return (
    <>
      {/* Прогрес тайтлу */}
      <div className="hp-card hp-summary">
        <div className="hp-row">
          <span className="hp-grow hp-small">
            Прочитано <b>{read}</b> з {total} розділів
            {target && read > 0 && (
              <span className="hp-muted"> · далі: Розділ {target.number}</span>
            )}
          </span>
          <span className="hp-small hp-muted">{pct}%</span>
        </div>
        <div className="hp-progress">
          <div style={{ width: `${pct}%` }} />
        </div>
      </div>

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
          <select
            className="hp-select"
            value={team}
            title="Команда перекладу"
            onChange={(e) => void setTeam(e.target.value)}
          >
            <option value="">Усі команди ({teams.length})</option>
            {teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
        {teams.length === 1 && <span className="hp-badge" title="Команда перекладу">{teams[0]}</span>}
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
          const key = chapterKey(c.number);
          return (
            <div key={c.id} role="listitem">
              {volHead && <div className="hp-vol">Том {c.volume ?? '—'}</div>}
              <ChapterRow
                chapter={c}
                sourceId={s.activeId ?? ''}
                progress={s.progress.chapters[key]}
                current={key === lastKey}
              />
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Кружечок стану: порожній — не читав, сектор — прочитано частину, ✓ — прочитано. */
function StatusRing({ pos, read }: { pos: number; read: boolean }) {
  const r = 8;
  const len = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r={r} fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" />
      {read ? (
        <>
          <circle cx="10" cy="10" r={r} fill="currentColor" />
          <path d="m6.5 10.2 2.3 2.3 4.7-4.9" fill="none" stroke="var(--hp-bg)" strokeWidth="2" strokeLinecap="round" />
        </>
      ) : (
        pos > 0.01 && (
          <circle
            cx="10"
            cy="10"
            r={r}
            fill="none"
            stroke="var(--hp-primary-fg)"
            strokeWidth="2"
            strokeDasharray={`${len * pos} ${len}`}
            transform="rotate(-90 10 10)"
          />
        )
      )}
    </svg>
  );
}

function ChapterRow(props: {
  chapter: Chapter;
  sourceId: string;
  progress?: { pos: number; read: boolean };
  current: boolean;
}) {
  const { chapter: c, progress: p, current } = props;
  const read = !!p?.read;
  const pos = p?.pos ?? 0;
  const cls = ['hp-ch', read && 'hp-ch--read', current && 'hp-ch--current'].filter(Boolean).join(' ');
  return (
    <div className={cls} onClick={() => openReader({ sourceId: props.sourceId, chapterId: c.id })} role="button" tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && openReader({ sourceId: props.sourceId, chapterId: c.id })}>
      <button
        type="button"
        className={`hp-status ${read ? 'hp-status--read' : ''}`}
        title={read ? 'Позначити непрочитаним' : 'Позначити прочитаним'}
        onClick={(e) => {
          e.stopPropagation();
          void setChapterRead(c, !read);
        }}
      >
        <StatusRing pos={pos} read={read} />
      </button>
      <span className="hp-grow hp-ellipsis hp-ch__title">
        Розділ {c.number}
        {c.name ? <span className="hp-muted"> — {c.name}</span> : null}
      </span>
      {!read && pos > 0.01 && <span className="hp-ch__pct">{Math.round(pos * 100)}%</span>}
      {c.team && (
        <span className="hp-ch__meta hp-ellipsis" style={{ maxWidth: 140 }}>
          {c.team}
        </span>
      )}
      {c.date && <span className="hp-ch__meta">{dateFmt.format(c.date)}</span>}
    </div>
  );
}

function BindSearch({ state: s, sourceId, onDone }: { state: TitleState; sourceId: string; onDone: () => void }) {
  const sources = sourcesFor(s.page.kind);
  const [srcId, setSrcId] = useState(sourceId);
  const [query, setQuery] = useState(() => (s.hikka ? (titleNames(s.hikka)[0] ?? '') : ''));
  const [results, setResults] = useState<RemoteTitle[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const source = getSource(srcId) as ReadSource | undefined;

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
  }, [srcId]);

  return (
    <div className="hp-card" style={{ padding: 12 }}>
      {overallStatus(s) === 'not-found' && (
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
        <select className="hp-select" value={srcId} onChange={(e) => setSrcId(e.target.value)}>
          {sources.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
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
              {r.cover ? (
                <img src={r.cover} alt="" loading="lazy" referrerPolicy="no-referrer" />
              ) : (
                <span style={{ width: 40 }} />
              )}
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
