import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { titleNames } from '../core/hikka';
import { chapterKey, posText, type ChapterProgress } from '../core/store';
import { getSource, sourcesFor } from '../sources/registry';
import { chapterNo, type Chapter, type ReadSource, type RemoteTitle } from '../sources/types';
import { IconExternal, IconLink, IconSearch, IconSort } from '../ui/icons';
import { Button, btn, ChipMenu, ChipTabs, Header, Progress, Select } from '../ui/kit';
import { openReader } from './reader-url';
import { HikkaSyncBar } from './hikka-bar';
import { ExternalLinks } from './external-links';
import {
  activeSource,
  activeState,
  activeTeam,
  bindManually,
  continueTarget,
  overallStatus,
  rejectNear,
  setActiveSource,
  setChapterRead,
  setTeam,
  teamCounts,
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
    <section className="hp-section" aria-label="Розділи (Hikka Plus)">
      <Header title="Розділи">
        {src && act?.remote?.url && !searchFor && (
          <a
            className={btn('ghost', 'sm')}
            href={act.remote.url}
            target="_blank"
            rel="noreferrer"
            title={`${act.remote.title} на ${src.name}`}
          >
            {src.name}
            <IconExternal />
          </a>
        )}
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={!!(searchFor && binding)}
          onClick={() => setBinding(searchFor ? null : (s.activeId ?? sourcesFor(s.page.kind)[0]?.id ?? null))}
          title="Знайти тайтл на джерелі вручну"
        >
          <IconLink />
          {searchFor && binding ? 'Скасувати' : 'Знайти вручну'}
        </Button>
      </Header>

      <div className="hp-card">
        <SourceSwitcher state={s} searchFor={searchFor} onSearch={(id) => setBinding(id)} onCancel={() => setBinding(null)} />

        <NearHints state={s} onBound={() => setBinding(null)} />

        {searchFor && <BindSearch key={searchFor} state={s} sourceId={searchFor} onDone={() => setBinding(null)} />}

        {!searchFor && status === 'loading' && (
          <div className="hp-col">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="hp-skeleton" />
            ))}
          </div>
        )}
        {!searchFor && status === 'error' && (
          <div className="hp-state">{s.hikkaError ?? act?.error ?? 'Помилка завантаження'}</div>
        )}
        {!searchFor && status === 'ready' && <ChapterList state={s} />}
      </div>
      <ExternalLinks state={s} />
    </section>
  );
}

/**
 * «Схоже»: автопідбір не дотягнув до порогу, але є схожий тайтл (інша назва перекладу тощо).
 * Прив'язується лише по кліку; «Ні» запам'ятовується для тайтлу.
 */
function NearHints({ state: s, onBound }: { state: TitleState; onBound: () => void }) {
  const [all, setAll] = useState(false);
  const list = sourcesFor(s.page.kind).flatMap((src) => {
    const st = s.sources[src.id];
    return st?.status === 'not-found' && st.near ? [{ src, near: st.near }] : [];
  });
  if (!list.length) return null;
  const shown = all ? list : list.slice(0, 1);
  return (
    <div className="hp-col hp-near">
      {shown.map(({ src, near }) => (
        <div key={src.id} className="hp-hikka hp-hikka--offer">
          <span className="hp-grow hp-small">
            Схоже: {src.name} — «
            {near.url ? (
              <a className="hp-near__link" href={near.url} target="_blank" rel="noreferrer" title="Відкрити на сайті">
                {near.title}
              </a>
            ) : (
              near.title
            )}
            »
          </span>
          <Button
            variant="default"
            size="sm"
            title={`Читати «${near.title}» з ${src.name} для цього тайтлу`}
            onClick={() => {
              onBound();
              void bindManually(src, near);
            }}
          >
            Прив'язати
          </Button>
          <Button variant="ghost" size="sm" title="Це інший тайтл — більше не пропонувати" onClick={() => void rejectNear(src.id)}>
            Ні
          </Button>
        </div>
      ))}
      {list.length > 1 && (
        <Button variant="ghost" size="sm" className="hp-near__more" onClick={() => setAll(!all)}>
          {all ? 'Згорнути' : `ще ${list.length - 1}`}
        </Button>
      )}
    </div>
  );
}

/** Перемикач джерел: назва + кількість розділів або статус пошуку. */
function SourceSwitcher({
  state: s,
  searchFor,
  onSearch,
  onCancel,
}: {
  state: TitleState;
  /** Режим ручного пошуку: плашки обирають, ДЕ шукати (замість окремого списку). */
  searchFor: string | null;
  onSearch: (id: string) => void;
  /** Вийти з ручного пошуку. */
  onCancel: () => void;
}) {
  const all = sourcesFor(s.page.kind);
  const isFound = (id: string) => {
    const st = s.sources[id];
    return !!st && st.status !== 'not-found' && st.status !== 'searching';
  };
  const size = (id: string) => new Set(s.sources[id]?.chapters.map((c) => chapterKey(c.number))).size;
  // Звичайний режим: у ряду лише джерела, де тайтл знайшовся (більше розділів — лівіше),
  // решта — у плашці «Ще N». Поки нічого не знайдено або йде ручний пошук — усі плашки.
  const found = all
    .filter((src) => (isFound(src.id) && s.sources[src.id]?.status !== 'error') || src.id === s.activeId).sort((a, b) => size(b.id) - size(a.id));
  const compact = !searchFor && found.length > 0;
  const list = compact ? found : all;
  const rest = compact ? all.filter((src) => !found.includes(src)) : [];
  const status = (id: string) => {
    const st = s.sources[id];
    return !st ? '' : st.status === 'searching' ? 'шукаю…' : st.status === 'error' ? 'помилка' : 'немає';
  };
  const restSearching = rest.some((src) => s.sources[src.id]?.status === 'searching');
  return (
    <ChipTabs
      label={searchFor ? 'Де шукати' : 'Джерело'}
      extra={
        rest.length > 0 && (
          <ChipMenu
            label={
              <>
                Ще {rest.length}
                {restSearching && <span className="hp-chip__count">шукаю…</span>}
              </>
            }
            title="Інші джерела — тайтл не знайдено автоматично"
            items={rest.map((src) => ({
              value: src.id,
              label: src.name,
              hint: status(src.id),
              title: `Шукати на ${src.name} вручну`,
            }))}
            onPick={onSearch}
          />
        )
      }
      value={searchFor ?? s.activeId}
      onPick={(id) => {
        const st = s.sources[id];
        const found = st && st.status !== 'not-found' && st.status !== 'searching';
        // Знайдене джерело — завжди до його розділів (і з ручного пошуку теж); ненайдене — шукати вручну.
        if (!found) return onSearch(id);
        onCancel();
        if (id !== s.activeId) void setActiveSource(id);
      }}
      options={list.map((src) => {
        const st = s.sources[src.id];
        const found = !!st && st.status !== 'not-found' && st.status !== 'searching';
        const count = !st
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
        return {
          value: src.id,
          label: src.name,
          count,
          off: !found,
          title: found
            ? `Читати з ${src.name}`
            : searchFor
              ? `Шукати на ${src.name}`
              : `Не знайдено на ${src.name} — шукати вручну`,
        };
      })}
    />
  );
}

function ChapterList({ state: s }: { state: TitleState }) {
  const [query, setQuery] = useState('');
  const [desc, setDesc] = useState(false);
  const all = activeState(s)?.chapters ?? [];
  const team = activeTeam(s);
  const chapters = visibleChapters(s);

  // Команди й скільки розділів переклала кожна.
  const counts = useMemo(() => teamCounts(all), [all]);
  const teams = [...counts.keys()];

  const shown = useMemo(() => {
    const q = query.trim().replace(',', '.').toLowerCase();
    let list = chapters.filter(
      (c) => !q || c.number.startsWith(q) || !!c.shown?.startsWith(q) || (c.name ?? '').toLowerCase().includes(q),
    );
    if (desc) list = [...list].reverse();
    return list;
  }, [chapters, query, desc]);

  const { read, total } = titleProgress(s);
  const pct = total ? Math.round((read / total) * 100) : 0;
  const target = continueTarget(s);
  const lastKey = s.progress.last?.key;

  // Список одразу на останньому відкритому розділі (або на тому, з якого продовжувати), щоб не гортати.
  // Лише прокрутка всередині списку; повторюємо при зміні джерела, команди чи сортування,
  // але не при кожному оновленні прогресу (інакше список стрибав би під час читання).
  const listRef = useRef<HTMLDivElement>(null);
  const focusKey = lastKey ?? (target ? chapterKey(target.number) : null);
  const ready = shown.length > 0;
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !focusKey || query) return;
    const row = list.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`);
    if (!row) return;
    const lr = list.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    list.scrollTop += rr.top - lr.top - (list.clientHeight - rr.height) / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.activeId, team, desc, ready]);

  if (!all.length) return <div className="hp-state">Розділів поки немає.</div>;

  const hasVolumes = chapters.some((c) => c.volume);
  let lastVol: string | null | undefined;

  return (
    <>
      {/* Прогрес тайтлу */}
      <div className="hp-col hp-col--tight">
        <div className="hp-row hp-small">
          <span className="hp-grow">
            Прочитано <b>{read}</b> з {total}
            {target && read > 0 && <span className="hp-muted"> · далі: розділ {chapterNo(target)}</span>}
          </span>
          <span className="hp-muted hp-tnum">{pct}%</span>
        </div>
        <Progress value={pct} />
        <HikkaSyncBar state={s} />
      </div>

      <div className="hp-toolbar">
        <label className="hp-search hp-grow">
          <IconSearch />
          <input
            className="hp-input"
            placeholder="Номер або назва розділу"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {teams.length > 1 && (
          <Select
            className="hp-toolbar__team"
            title="Команда перекладу"
            value={team}
            onChange={(v) => void setTeam(v)}
            options={[
              { value: '', label: 'Усі команди', hint: String(new Set(all.map((c) => chapterKey(c.number))).size) },
              ...teams.map((t) => ({ value: t, label: t, hint: String(counts.get(t)) })),
            ]}
          />
        )}
        {teams.length === 1 && (
          <span className="hp-badge hp-ellipsis" title="Команда перекладу">
            {teams[0]}
          </span>
        )}
        <Button
          variant="outline"
          size="md"
          icon
          title={desc ? 'Спочатку перші' : 'Спочатку нові'}
          aria-label={desc ? 'Спочатку перші' : 'Спочатку нові'}
          onClick={() => setDesc((v) => !v)}
        >
          <IconSort />
        </Button>
      </div>

      <div ref={listRef} className="hp-list" role="list">
        {shown.length === 0 && <div className="hp-state">Нічого не знайдено.</div>}
        {shown.map((c) => {
          const volHead = hasVolumes && c.volume !== lastVol;
          lastVol = c.volume;
          const key = chapterKey(c.number);
          return (
            <div key={c.id} role="listitem" data-key={key}>
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
  progress?: ChapterProgress;
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
      <span className="hp-ellipsis hp-ch__title">
        Розділ {chapterNo(c)}
        {c.name ? <span className="hp-muted"> — {c.name}</span> : null}
      </span>
      {/* Прогрес — одразу біля назви, щоб не губився серед команди й дати справа. */}
      {!read && p && pos > 0.01 && <span className="hp-ch__pct">{posText(p)}</span>}
      <span className="hp-grow" />
      {c.team && (
        <span className="hp-ch__meta hp-ch__team hp-ellipsis">{c.team}</span>
      )}
      {c.date && <span className="hp-ch__meta">{dateFmt.format(c.date)}</span>}
    </div>
  );
}

function BindSearch({ state: s, sourceId, onDone }: { state: TitleState; sourceId: string; onDone: () => void }) {
  const srcId = sourceId;
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
    <div className="hp-col">
      <p className="hp-small hp-muted hp-p">
        {overallStatus(s) === 'not-found' && 'Автоматично не знайшов цей тайтл на українських джерелах. '}
        Шукаю на <b className="hp-fg">{source?.name}</b> — інше джерело обери вище. Прив'язка запам'ятається.
      </p>
      <form
        className="hp-row"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <label className="hp-search hp-grow">
          <IconSearch />
          <input
            className="hp-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Назва на ${source?.name ?? 'джерелі'}`}
            aria-label={`Пошук на ${source?.name ?? 'джерелі'}`}
          />
        </label>
        <Button type="submit" variant="secondary" size="md" disabled={busy}>
          {busy ? 'Шукаю…' : 'Шукати'}
        </Button>
      </form>
      {err && <div className="hp-state">{err}</div>}
      {results && results.length === 0 && <div className="hp-state">Нічого не знайдено на {source?.name}.</div>}
      {results && results.length > 0 && (
        <div className="hp-list hp-list--results">
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
                <span className="hp-result__nocover" />
              )}
              <span className="hp-grow">
                <span className="hp-ellipsis hp-result__title">{r.title}</span>
                <span className="hp-ellipsis hp-xs hp-muted hp-block">
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
