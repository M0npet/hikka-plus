/*
 * Блок «Перегляд» на сторінці аніме (між «Опис» і «Головні персонажі»).
 * Команда → плеєр → iframe самого плеєра; кнопка Dawn веде на Mikai (вбудовування немає);
 * «Ширше» переносить плеєр над колонками сторінки (portal у свій host), сітка серій лишається тут.
 * iframe при переносі перезавантажується — повертаємо його на ту саму секунду командою плеєра.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, Check, ChipTabs, Header, SwitchRow, btn } from '../ui/kit';
import { IconExpand, IconExternal, IconEye, IconHeart, IconLeft, IconRight, IconSettings, IconShrink, IconTv } from '../ui/icons';
import { attachPlayer } from './adapters';
import { useWideLayout } from './wide-layout';
import { PLAYER_NAMES, SITE_NAMES, teamEpisodes, type EpisodeState, type WatchPlayer, type WatchTeam } from './types';
import type { WatchPrefs } from './watch-store';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
const RANGE = 50;

export type HikkaLine = { kind: 'count'; n: number } | { kind: 'connect'; onClick: () => void } | { kind: 'error'; message: string } | null;

export type WatchBlockProps = {
  status: 'loading' | 'ready' | 'not-found';
  error?: string;
  teams: WatchTeam[];
  /** Стан серій за номером. */
  episodes: Record<number, EpisodeState>;
  /** Серій за Hikka (сітка показує й ще не додані на сайти). */
  total?: number;
  hikka?: HikkaLine;
  /** Посилання «Anitube» (лише посиланням — Cloudflare). */
  anitube?: string;
  /** Поріг зарахування поточної серії: at — секунда, ed — це початок ендингу (а не «за 90 с до кінця»). */
  edInfo?: { ep: number; at: number; ed: boolean } | null;
  prefs: WatchPrefs;
  onPrefs: (p: Partial<WatchPrefs>) => void;
  /** Куди переносити плеєр у режимі «Ширше» (host над колонками сторінки). */
  theater?: HTMLElement | null;
  /** Останній вибір і позиція (зі сховища). */
  initial?: { team?: string; player?: string; ep?: number; t?: number };
  /** Поточна секунда (для повернення після перезавантаження iframe). */
  resumeAt?: () => number;
  onSelect?: (s: { team: string; player: string; ep: number }) => void;
  onTime?: (ep: number, t: number, duration: number) => void;
  onEdStart?: (ep: number, sec: number) => void;
  onEnded?: (ep: number) => void;
  /** Вміст рамки замість iframe (стенд). */
  renderFrame?: (p: WatchPlayer, ep: number) => ReactNode;
};

/* ---------- Список із багатим пунктом (Команда / Плеєр) ---------- */

function Picker<T>({
  items,
  value,
  keyOf,
  trigger,
  item,
  onPick,
  label,
  className,
}: {
  items: T[];
  value: T | undefined;
  keyOf: (t: T) => string;
  trigger: ReactNode;
  item: (t: T) => ReactNode;
  onPick: (t: T) => void;
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !wrap.current) return;
    const root = wrap.current.getRootNode() as Document | ShadowRoot;
    const onRoot = (e: Event) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onDoc = (e: Event) => root instanceof ShadowRoot && e.target !== root.host && setOpen(false);
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    root.addEventListener('pointerdown', onRoot, true);
    if (root !== document) document.addEventListener('pointerdown', onDoc, true);
    window.addEventListener('keydown', onEsc, true);
    return () => {
      root.removeEventListener('pointerdown', onRoot, true);
      document.removeEventListener('pointerdown', onDoc, true);
      window.removeEventListener('keydown', onEsc, true);
    };
  }, [open]);
  return (
    <div ref={wrap} className={cx('hp-select', className)}>
      <button
        type="button"
        className="hp-input hp-input--lg hp-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="hp-grow hp-watch__trig">{trigger}</span>
        <svg className="hp-icon hp-select__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m7 15 5 5 5-5" />
          <path d="m7 9 5-5 5 5" />
        </svg>
      </button>
      {open && (
        <div className="hp-popover hp-watch__pop" role="listbox" aria-label={label}>
          {items.map((t) => {
            const on = !!value && keyOf(t) === keyOf(value);
            return (
              <div
                key={keyOf(t)}
                role="option"
                aria-selected={on}
                className="hp-option hp-watch__opt"
                onClick={() => {
                  onPick(t);
                  setOpen(false);
                }}
              >
                <Check on={on} />
                {item(t)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const Avatar = ({ t }: { t: WatchTeam }) => {
  const [bad, setBad] = useState(false);
  return t.avatar && !bad ? (
    <img className="hp-watch__ava" src={t.avatar} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setBad(true)} />
  ) : (
    <span className="hp-watch__ava" aria-hidden="true">
      {t.name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase()}
    </span>
  );
};

const TeamLine = ({ t, full }: { t: WatchTeam; full?: boolean }) => (
  <>
    <Avatar t={t} />
    <span className="hp-grow hp-ellipsis">{t.name}</span>
    <span className={cx('hp-watch__kind', t.sub && 'hp-watch__kind--sub')}>{t.sub ? 'Субтитри' : 'Озвучка'}</span>
    {full && <span className="hp-option__hint">{teamEpisodes(t)} еп.</span>}
  </>
);

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/* ---------- Сам блок ---------- */

export function WatchBlock(p: WatchBlockProps) {
  const init = p.initial;
  const [teamId, setTeamId] = useState<string | undefined>(init?.team);
  const [playerId, setPlayerId] = useState<string | undefined>(init?.player);
  const [ep, setEp] = useState(init?.ep && init.ep > 0 ? init.ep : 1);
  const [wide, setWide] = useState(false);
  const [menu, setMenu] = useState(false);
  const [range, setRange] = useState('0');
  // З якої секунди почати після (пере)завантаження iframe.
  const startAt = useRef(init?.t ?? 0);
  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const [slotEl, setSlotEl] = useState<HTMLDivElement | null>(null);
  const [full, setFull] = useState(false);
  const canFull = typeof document !== 'undefined' && document.fullscreenEnabled !== false;

  const team = p.teams.find((t) => t.id === teamId) ?? p.teams[0];
  const players = useMemo(() => {
    const list = team?.players ?? [];
    // Улюблений плеєр — першим.
    return [...list].sort((a, b) => Number(b.kind === p.prefs.favPlayer) - Number(a.kind === p.prefs.favPlayer));
  }, [team, p.prefs.favPlayer]);
  const player = players.find((x) => x.id === playerId) ?? players[0];
  const dupKind = (x: WatchPlayer) => players.filter((y) => y.kind === x.kind).length > 1;
  const count = Math.max(team ? teamEpisodes(team) : 0, p.total ?? 0, ep);
  const has = (n: number) => !!player?.episodes.includes(n);

  useEffect(() => {
    setRange(String(Math.floor((ep - 1) / RANGE)));
  }, [ep]);
  useEffect(() => {
    if (team && player) p.onSelect?.({ team: team.id, player: player.id, ep });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.id, player?.id, ep]);

  const goEp = (n: number) => {
    if (n === ep) return;
    startAt.current = 0;
    setEp(n);
  };
  const toggleWide = (v: boolean) => {
    startAt.current = p.resumeAt?.() ?? startAt.current;
    setWide(v);
  };
  const lay = useWideLayout(wide && !!p.theater, slotEl, stageEl, p.theater ?? null, () => setWide(false));
  // Після перемикання «Ширше» — прокрутити до плеєра.
  useEffect(() => {
    const t = setTimeout(() => stageRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);
    return () => clearTimeout(t);
  }, [wide]);
  // Повний екран — рамка разом з iframe (сам iframe не перезавантажується, позиція й адаптер лишаються).
  useEffect(() => {
    const on = () => {
      const el = frameRef.current;
      setFull(!!el && (document.fullscreenElement === el || (el.getRootNode() as ShadowRoot).fullscreenElement === el));
    };
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggleFull = () => {
    if (full) void document.exitFullscreen?.().catch(() => {});
    else void frameRef.current?.requestFullscreen?.().catch(() => {});
  };

  if (p.status === 'loading')
    return (
      <section className="hp-section">
        <Header title="Перегляд" />
        <div className="hp-card">
          <div className="hp-skeleton" style={{ height: 48 }} />
          <div className="hp-skeleton hp-watch__frame" />
        </div>
      </section>
    );

  const anitube = p.anitube && (
    <a className={btn('ghost', 'sm')} href={p.anitube} target="_blank" rel="noreferrer noopener">
      Anitube
      <IconExternal />
    </a>
  );

  if (p.status === 'not-found' || !team || !player)
    return (
      <section className="hp-section">
        <Header title="Перегляд">{anitube}</Header>
        <div className="hp-card">
          <p className="hp-p hp-state">{p.error ? `Не вдалося завантажити серії: ${p.error}` : 'Не знайшли серій на Mikai та AnimeON.'}</p>
        </div>
      </section>
    );

  const st = p.episodes[ep];
  const ed = p.edInfo && p.edInfo.ep === ep ? p.edInfo : null;
  const frame = (
    <div
      ref={(el) => {
        stageRef.current = el;
        setStageEl(el);
      }}
      className={cx('hp-watch__stage', wide && 'hp-watch__stage--wide')}
    >
      <div ref={frameRef} className="hp-watch__frame">
        {p.renderFrame ? (
          p.renderFrame(player, ep)
        ) : (
          <PlayerFrame
            key={`${player.id}:${ep}`}
            player={player}
            ep={ep}
            startAt={startAt}
            onTime={(t, d) => p.onTime?.(ep, t, d)}
            onEdStart={(s) => p.onEdStart?.(ep, s)}
            onEnded={() => {
              p.onEnded?.(ep);
              if (p.prefs.autoNext && ep < count && has(ep + 1)) goEp(ep + 1);
            }}
            onEpisode={(n) => n !== ep && has(n) && goEp(n)}
          />
        )}
      </div>
      {wide && (
        <div className="hp-watch__stagebar">
          <span className="hp-ellipsis">
            {team.name} · {PLAYER_NAMES[player.kind]} · Серія {ep}
          </span>
          <Button variant="secondary" size="sm" onClick={() => toggleWide(false)}>
            <IconShrink />
            Звичайний розмір
          </Button>
        </div>
      )}
    </div>
  );
  const portal = wide && p.theater;

  const ranges = Math.ceil(count / RANGE);
  const from = ranges > 1 ? Number(range) * RANGE + 1 : 1;
  const to = ranges > 1 ? Math.min(count, from + RANGE - 1) : count;
  const h = p.hikka;

  return (
    <section className="hp-section hp-watch">
      <Header title="Перегляд">
        {anitube}
        <div className="hp-select">
          <Button variant="ghost" size="sm" icon aria-label="Налаштування плеєра" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            <IconSettings />
          </Button>
          {menu && (
            <div className="hp-popover hp-popover--end hp-watch__menu">
              <SwitchRow label="Автоперехід" hint="Наступна серія після кінця поточної" checked={p.prefs.autoNext} onChange={(v) => p.onPrefs({ autoNext: v })} />
              <SwitchRow label="Відмічати в Hikka" hint="Серія зараховується, коли дійшли до ендингу" checked={p.prefs.hikkaSync} onChange={(v) => p.onPrefs({ hikkaSync: v })} />
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon
          className="hp-watch__wide"
          aria-pressed={wide}
          aria-label={wide ? 'Звичайний розмір' : 'Ширше'}
          title={wide ? 'Звичайний розмір' : 'Ширше'}
          onClick={() => toggleWide(!wide)}
        >
          <IconTv />
        </Button>
        {canFull && (
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label={full ? 'Вийти з повного екрана' : 'На весь екран'}
            title={full ? 'Вийти з повного екрана' : 'На весь екран'}
            onClick={toggleFull}
          >
            {full ? <IconShrink /> : <IconExpand />}
          </Button>
        )}
      </Header>

      <div className="hp-card">
        <div className="hp-watch__bar">
          <Picker
            className="hp-watch__team"
            label="Команда"
            items={p.teams}
            value={team}
            keyOf={(t) => t.id}
            trigger={<TeamLine t={team} />}
            item={(t) => <TeamLine t={t} full />}
            onPick={(t) => {
              startAt.current = 0;
              setTeamId(t.id);
              setPlayerId(undefined);
            }}
          />
          <Picker
            className="hp-watch__player"
            label="Плеєр"
            items={players}
            value={player}
            keyOf={(x) => x.id}
            trigger={<span className="hp-ellipsis">{PLAYER_NAMES[player.kind]}</span>}
            item={(x) => (
              <>
                <span className="hp-grow hp-ellipsis">{x.label || PLAYER_NAMES[x.kind]}</span>
                <span className="hp-option__hint">
                  {[x.noAds && 'Без реклами', dupKind(x) && SITE_NAMES[x.site]].filter(Boolean).join(' · ')}
                </span>
                <button
                  type="button"
                  className={cx('hp-watch__fav', p.prefs.favPlayer === x.kind && 'hp-watch__fav--on')}
                  aria-label="Улюблений плеєр"
                  aria-pressed={p.prefs.favPlayer === x.kind}
                  title="Улюблений плеєр — обирати першим"
                  onClick={(e) => {
                    e.stopPropagation();
                    p.onPrefs({ favPlayer: p.prefs.favPlayer === x.kind ? undefined : x.kind });
                  }}
                >
                  <IconHeart />
                </button>
              </>
            )}
            onPick={(x) => {
              startAt.current = p.resumeAt?.() ?? 0;
              setPlayerId(x.id);
            }}
          />
          {team.dawn && (
            <a className={btn('outline', 'lg', false, 'hp-watch__dawn')} href={team.dawn(ep)} target="_blank" rel="noreferrer noopener" title="Dawn не вбудовується — відкриється ця серія на Mikai">
              Dawn
              <IconExternal />
            </a>
          )}
        </div>

        {portal ? (
          // Місце під плеєр «Ширше»: сам плеєр лежить поверх сітки (wide-layout.ts), тут — лише його висота.
          <div
            ref={setSlotEl}
            className="hp-watch__slot"
            style={{ paddingTop: lay.offset, height: lay.offset + lay.height }}
            aria-hidden="true"
          />
        ) : (
          frame
        )}
        {portal && createPortal(frame, p.theater!)}

        <div className="hp-watch__nav">
          <Button variant="secondary" size="md" icon aria-label="Попередня серія" disabled={ep <= 1} onClick={() => goEp(ep - 1)}>
            <IconLeft />
          </Button>
          <div className="hp-watch__epname">
            <span>
              Серія {ep}
              <span className="hp-header__count"> з {count}</span>
            </span>
            <span className="hp-watch__hint">
              {st?.watched ? (
                <>
                  <IconEye /> Переглянуто
                </>
              ) : ed?.ed ? (
                `Зарахується з ${fmt(ed.at)} — ендинг`
              ) : (
                'Зарахується за 1:30 до кінця'
              )}
            </span>
          </div>
          <Button variant="secondary" size="md" icon aria-label="Наступна серія" disabled={ep >= count || !has(ep + 1)} onClick={() => goEp(ep + 1)}>
            <IconRight />
          </Button>
          {h?.kind === 'count' && (
            <span className="hp-watch__hikka">
              Hikka: {h.n} / {p.total ?? count}
            </span>
          )}
          {h?.kind === 'connect' && (
            <Button variant="ghost" size="sm" className="hp-watch__hikka" title="Увійти в Hikka з дозволом на список перегляду" onClick={h.onClick}>
              Відмічати в Hikka
            </Button>
          )}
          {h?.kind === 'error' && (
            <span className="hp-watch__hikka" title={h.message}>
              Hikka: помилка
            </span>
          )}
        </div>

        <div className="hp-sep" />

        <div className="hp-col hp-col--tight">
          <div className="hp-watch__epsHead">
            <span className="hp-setrow__label">Епізоди</span>
            {ranges > 1 && (
              <ChipTabs
                label="Діапазон серій"
                value={range}
                onPick={setRange}
                options={Array.from({ length: ranges }, (_, i) => ({
                  value: String(i),
                  label: `${i * RANGE + 1}–${Math.min(count, (i + 1) * RANGE)}`,
                }))}
              />
            )}
          </div>
          <div className="hp-watch__grid" role="list">
            {Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => {
              const n = from + i;
              const s = p.episodes[n];
              const on = n === ep;
              return (
                <button
                  key={n}
                  type="button"
                  role="listitem"
                  className={cx(btn(on ? 'default' : 'secondary', 'md'), 'hp-watch__ep', s?.watched && !on && 'hp-watch__ep--seen')}
                  disabled={!has(n)}
                  aria-current={on || undefined}
                  title={!has(n) ? `Серії ${n} ще немає в цього плеєра` : s?.watched ? `Серія ${n} — переглянуто` : s?.pos ? `Серія ${n} — ${Math.round(s.pos * 100)}%` : `Серія ${n}`}
                  onClick={() => goEp(n)}
                >
                  {s?.watched && <IconEye />}
                  {n}
                  {!s?.watched && s?.pos ? <span className="hp-watch__epbar" style={{ width: `${s.pos * 100}%` }} /> : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

/** iframe плеєра як є + адаптер позиції. Адресу беремо в провайдера (у AnimeON — запитом). */
export function PlayerFrame(p: {
  player: WatchPlayer;
  ep: number;
  startAt: { current: number };
  onTime: (t: number, d: number) => void;
  onEdStart: (sec: number) => void;
  onEnded: () => void;
  onEpisode: (n: number) => void;
}) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  const [err, setErr] = useState(false);
  const ref = useRef<HTMLIFrameElement>(null);
  const cb = useRef(p);
  cb.current = p;

  useEffect(() => {
    let off = false;
    setSrc(undefined);
    setErr(false);
    p.player
      .src(p.ep)
      .then((s) => !off && setSrc(s))
      .catch(() => {
        if (off) return;
        setErr(true);
        setSrc(null);
      });
    return () => {
      off = true;
    };
  }, [p.player, p.ep]);

  useEffect(() => {
    const f = ref.current;
    if (!src || !f) return;
    // Повернення на збережену секунду: лише коли відео справді пішло (після реклами Ashdi), до 3 спроб.
    let tries = 0;
    let lastTry = 0;
    let resumed = false;
    const ctl = attachPlayer(f, p.player.kind, {
      onTime: (t, d) => {
        const want = cb.current.startAt.current;
        if (!resumed && want > 5 && want < d - 5) {
          if (t >= want - 3) resumed = true;
          else if (t > 0.5 && tries < 3 && Date.now() - lastTry > 1500) {
            tries++;
            lastTry = Date.now();
            ctl.seek(want);
            return;
          } else if (tries < 3) return; // ще реклама/завантаження — позицію не рахуємо
        }
        resumed = true;
        cb.current.onTime(t, d);
      },
      onEnded: () => cb.current.onEnded(),
      onEdStart: (s) => cb.current.onEdStart(s),
      onEpisode: (n) => cb.current.onEpisode(n),
    });
    return ctl.detach;
  }, [src, p.player.kind]);

  if (src === undefined) return <div className="hp-watch__empty">Завантаження…</div>;
  if (!src) return <div className="hp-watch__empty">{err ? 'Не вдалося отримати плеєр' : `У цього плеєра немає серії ${p.ep}`}</div>;
  return (
    <iframe
      ref={ref}
      src={src}
      title={`${PLAYER_NAMES[p.player.kind]} — серія ${p.ep}`}
      allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
      allowFullScreen
      referrerPolicy="origin"
    />
  );
}
