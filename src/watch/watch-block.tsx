/*
 * Блок «Перегляд» на сторінці аніме (між «Опис» і «Головні персонажі»).
 * Команда → плеєр → iframe самого плеєра; кнопка Dawn веде на Mikai (вбудовування немає);
 * «Ширше» переносить плеєр над колонками сторінки (portal у свій host), сітка серій лишається тут.
 * iframe при переносі перезавантажується — повертаємо його на ту саму секунду командою плеєра.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, Check, ChipTabs, Header, Slider, SwitchRow, btn } from '../ui/kit';
import { IconExpand, IconExternal, IconEye, IconHeart, IconLeft, IconRight, IconSettings, IconShrink, IconTv } from '../ui/icons';
import { attachPlayer } from './adapters';
import { useWideLayout } from './wide-layout';
import { AMBIENT_MSG, AMBIENT_REQ, PLAYER_NAMES, SITE_NAMES, teamEpisodes, type EpisodeState, type WatchPlayer, type WatchTeam } from './types';
import { DEFAULT_AMBIENT_LEVEL, type WatchPrefs } from './watch-store';

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
  /** Перша непереглянута серія після останньої переглянутої (Hikka або наші відмітки). */
  nextEp?: number;
  /** Чи можна зняти відмітку «переглянуто» з серії (лічильник Hikka — лише з дозволом на запис). */
  canUnwatch?: (ep: number) => boolean;
  onUnwatch?: (ep: number) => void;
  /** Відмітити серію переглянутою вручну (глазок у сітці). */
  onMark?: (ep: number) => void;
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
  // Серія, з якою завантажено iframe. Fenix сам перемикає серії у своєму списку — тоді міняємо лише ep (сітка, лічильник),
  // а iframe не перезавантажуємо.
  const [frameEp, setFrameEp] = useState(ep);
  const selfSwitch = useRef(0);
  const picked = useRef(false); // серію вже вибрано (користувачем або автоматично) — не перестрибувати

  const [wide, setWide] = useState(!!p.prefs.wide);
  const [menu, setMenu] = useState(false);
  const menuWrap = useRef<HTMLDivElement>(null);
  // Меню налаштувань закривається кліком поза ним, Esc і кліком у плеєр (iframe забирає фокус — у вікна blur).
  useEffect(() => {
    if (!menu || !menuWrap.current) return;
    const root = menuWrap.current.getRootNode() as Document | ShadowRoot;
    const close = () => setMenu(false);
    const onRoot = (e: Event) => !menuWrap.current?.contains(e.target as Node) && close();
    const onDoc = (e: Event) => root instanceof ShadowRoot && e.target !== root.host && close();
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    root.addEventListener('pointerdown', onRoot, true);
    if (root !== document) document.addEventListener('pointerdown', onDoc, true);
    window.addEventListener('keydown', onEsc, true);
    window.addEventListener('blur', close);
    return () => {
      root.removeEventListener('pointerdown', onRoot, true);
      document.removeEventListener('pointerdown', onDoc, true);
      window.removeEventListener('keydown', onEsc, true);
      window.removeEventListener('blur', close);
    };
  }, [menu]);
  const [range, setRange] = useState('0');
  // З якої секунди почати після (пере)завантаження iframe.
  const startAt = useRef(init?.t ?? 0);
  const frameRef = useRef<HTMLDivElement>(null);
  // Підсвітка: canvas за рамкою (поза .hp-watch__frame — та обрізає вміст).
  const [glowEl, setGlowEl] = useState<HTMLCanvasElement | null>(null);
  const ambient = p.prefs.ambient !== false;
  const stageRef = useRef<HTMLElement | null>(null);
  const [stageEl, setStageEl] = useState<HTMLElement | null>(null);
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
  /** Плеєр команди, у якому є серія n: поточний, інакше перший за порядком (улюблений — першим). */
  const playerFor = (n: number) => (has(n) ? player : players.find((x) => x.episodes.includes(n)));
  /** Серія є хоч в одному плеєрі команди (MK 15:26: у Moon до 16, а в команди 21 — серії мали вибиратися). */
  const teamHas = (n: number) => !!playerFor(n);

  useEffect(() => {
    setRange(String(Math.floor((ep - 1) / RANGE)));
  }, [ep]);
  useEffect(() => {
    if (team && player) p.onSelect?.({ team: team.id, player: player.id, ep });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.id, player?.id, ep]);

  const goEp = (n: number) => {
    picked.current = true;
    // У поточного плеєра цієї серії немає — перемикаємося на плеєр команди, де вона є.
    const alt = playerFor(n);
    if (alt && player && alt.id !== player.id) setPlayerId(alt.id);
    if (n === ep && n === frameEp && (!alt || alt.id === player?.id)) return;
    startAt.current = 0;
    setEp(n);
    setFrameEp(n);
  };
  /** Плеєр сам перейшов на серію n (Fenix): лише відмічаємо, iframe лишається. */
  const playerEp = (n: number) => {
    if (n === ep || !has(n)) return;
    picked.current = true;
    selfSwitch.current = Date.now();
    startAt.current = 0;
    setEp(n);
  };
  // Інший плеєр/команда — вантажимо ту серію, яку зараз видно (після самоперемикання Fenix вона новіша за frameEp).
  useEffect(() => {
    setFrameEp(ep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.id, player?.id]);
  // Заходимо на тайтл: якщо поточна серія вже переглянута — стаємо на першу непереглянуту (лічильник Hikka
  // приходить не одразу). Лише доки користувач сам нічого не вибрав.
  useEffect(() => {
    const n = p.nextEp;
    if (picked.current || !n || n === ep || !player || !teamHas(n)) return;
    if (!p.episodes[ep]?.watched) return; // почата й не дограна — лишаємо
    picked.current = true;
    goEp(n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.nextEp, player?.id]);
  const goEpRef = useRef(goEp);
  goEpRef.current = goEp;
  const toggleWide = (v: boolean) => {
    startAt.current = p.resumeAt?.() ?? startAt.current;
    // Наш блок у центрі міг стояти нижче (заповнення порожнечі) — повертаємо до того, як плеєр переїде в нього.
    if (!v) layRef.current();
    setWide(v);
    p.onPrefs({ wide: v });
  };
  // «Ширше» — спільне для всіх тайтлів (налаштування могли дочитатися пізніше або змінитися у вікні налаштувань).
  useEffect(() => {
    if (p.prefs.wide === undefined) return;
    if (!p.prefs.wide) layRef.current();
    setWide(p.prefs.wide);
  }, [p.prefs.wide]);
  const layRef = useRef<() => void>(() => {});
  const lay = useWideLayout(wide && !!p.theater, slotEl, stageEl, p.theater ?? null, () => {
    layRef.current();
    setWide(false);
  });
  layRef.current = lay.restore;
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
    <div className="hp-watch__view">
    {ambient && !p.renderFrame && (
      <canvas
        ref={setGlowEl}
        className="hp-watch__glow"
        aria-hidden="true"
        style={{ '--hp-glow': String((p.prefs.ambientLevel ?? DEFAULT_AMBIENT_LEVEL) / 100) } as CSSProperties}
      />
    )}
    <div ref={frameRef} className={`hp-watch__frame hp-watch__frame--${player.kind}`}>
      {p.renderFrame ? (
        p.renderFrame(player, ep)
      ) : (
        <PlayerFrame
          key={`${player.id}:${frameEp}`}
          player={player}
          ep={frameEp}
          startAt={startAt}
          onTime={(t, d) => p.onTime?.(ep, t, d)}
          onEdStart={(s) => p.onEdStart?.(ep, s)}
          onEnded={() => {
            const cur = ep;
            p.onEnded?.(cur);
            if (!p.prefs.autoNext || cur >= count || !teamHas(cur + 1)) return;
            if (player.kind !== 'fenix' || !has(cur + 1)) return goEp(cur + 1);
            // Fenix може й сам перейти на наступну (episode_change) — тоді не перезавантажуємо.
            const at = Date.now();
            setTimeout(() => {
              if (selfSwitch.current < at) goEpRef.current(cur + 1);
            }, 3000);
          }}
          onEpisode={playerEp}
          glow={ambient ? glowEl : null}
        />
      )}
    </div>
    </div>
  );
  const portal = wide && p.theater;
  const stageCb = (el: HTMLElement | null) => {
    stageRef.current = el;
    setStageEl(el);
  };

  const ranges = Math.ceil(count / RANGE);
  const from = ranges > 1 ? Number(range) * RANGE + 1 : 1;
  const to = ranges > 1 ? Math.min(count, from + RANGE - 1) : count;
  const h = p.hikka;

  const bar = (
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
  );
  const rest = (
    <>

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
                {p.canUnwatch?.(ep) ? (
                  <Button variant="ghost" size="xs" className="hp-watch__undo" title={`Зняти відмітку з серії ${ep}`} onClick={() => p.onUnwatch?.(ep)}>
                    Скасувати
                  </Button>
                ) : (
                  <span title="Зарахована в списку Hikka. Щоб зняти — «−» у віджеті Hikka або «Відмічати в Hikka».">· у Hikka</span>
                )}
              </>
            ) : ed?.ed ? (
              `Зарахується з ${fmt(ed.at)} — ендинг`
            ) : (
              'Зарахується за 1:30 до кінця'
            )}
          </span>
        </div>
        <Button variant="secondary" size="md" icon aria-label="Наступна серія" disabled={ep >= count || !teamHas(ep + 1)} onClick={() => goEp(ep + 1)}>
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
            const seen = !!s?.watched;
            const lockSeen = seen && !p.canUnwatch?.(n);
            return (
              <div key={n} role="listitem" className={cx('hp-watch__cell', seen && 'hp-watch__cell--seen')}>
                <button
                  type="button"
                  className={cx(btn(on ? 'default' : 'secondary', 'md'), 'hp-watch__ep', seen && !on && 'hp-watch__ep--seen')}
                  disabled={!teamHas(n)}
                  aria-current={on || undefined}
                  title={!teamHas(n) ? `Серії ${n} ще немає в цієї команди` : !has(n) ? `Серія ${n} — у плеєрі ${PLAYER_NAMES[playerFor(n)!.kind]}` : seen ? `Серія ${n} — переглянуто` : s?.pos ? `Серія ${n} — ${Math.round(s.pos * 100)}%` : `Серія ${n}`}
                  onClick={() => goEp(n)}
                >
                  {n}
                  {!seen && s?.pos ? <span className="hp-watch__epbar" style={{ width: `${s.pos * 100}%` }} /> : null}
                </button>
                {/* Глазок — окремий перемикач «переглянуто» (MK 03:54: «тут має бути можливість позначати»). */}
                {(teamHas(n) || seen) && (
                  <button
                    type="button"
                    className="hp-watch__eye"
                    aria-pressed={seen}
                    aria-label={seen ? `Зняти відмітку з серії ${n}` : `Позначити серію ${n} переглянутою`}
                    title={
                      lockSeen
                        ? 'Зарахована в списку Hikka. Щоб зняти — «−» у віджеті Hikka або «Відмічати в Hikka».'
                        : seen
                          ? `Зняти відмітку з серії ${n}`
                          : `Позначити серію ${n} переглянутою`
                    }
                    disabled={lockSeen}
                    onClick={() => (seen ? p.onUnwatch?.(n) : p.onMark?.(n))}
                  >
                    <IconEye />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );

  const body = (
    <>
      <Header title="Перегляд">
        {anitube}
        <div className="hp-select" ref={menuWrap}>
          <Button variant="ghost" size="sm" icon aria-label="Налаштування плеєра" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            <IconSettings />
          </Button>
          {menu && (
            <div className="hp-popover hp-popover--end hp-watch__menu">
              <SwitchRow label="Автоперехід" hint="Наступна серія після кінця поточної" checked={p.prefs.autoNext} onChange={(v) => p.onPrefs({ autoNext: v })} />
              <SwitchRow label="Відмічати в Hikka" hint="Серія зараховується, коли дійшли до ендингу" checked={p.prefs.hikkaSync} onChange={(v) => p.onPrefs({ hikkaSync: v })} />
              <SwitchRow label="Підсвітка" hint="Кольори з відео навколо плеєра" checked={ambient} onChange={(v) => p.onPrefs({ ambient: v })} />
              {ambient && (
                <Slider
                  label="Інтенсивність підсвітки"
                  value={p.prefs.ambientLevel ?? DEFAULT_AMBIENT_LEVEL}
                  min={10}
                  max={100}
                  step={5}
                  format={(v) => `${v}%`}
                  onChange={(ambientLevel) => p.onPrefs({ ambientLevel })}
                />
              )}
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
        {bar}
        {frame}
        {rest}
      </div>
    </>
  );

  // «Ширше» (рішення MK 2026-11-23, 03:06): увесь блок — на ширину сітки, на місці плеєра під верхніми картками
  // бічних колонок (host над сіткою, wide-layout.ts); у центральній колонці лишається лише місце потрібної висоти.
  if (portal)
    return (
      <section className="hp-section hp-watch">
        <div
          ref={setSlotEl}
          className="hp-watch__slot"
          style={{ paddingTop: lay.offset, height: lay.offset + lay.height }}
          aria-hidden="true"
        />
        {createPortal(
          <section ref={stageCb} className="hp-section hp-watch hp-watch__stage hp-watch__stage--wide">
            {body}
          </section>,
          p.theater!,
        )}
      </section>
    );

  return (
    <section ref={stageCb} className="hp-section hp-watch hp-watch__stage">
      {body}
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
  /** Canvas підсвітки за рамкою; null — підсвітку вимкнено. */
  glow?: HTMLCanvasElement | null;
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

  // Підсвітка: кадр 32×18 (рядок RGB) від нашого скрипта у фреймі (entrypoints/player-frame.content.ts) → canvas за рамкою (CSS розмиває).
  useEffect(() => {
    const f = ref.current;
    const c = p.glow ?? null;
    if (!src || !f) return;
    let origin = '';
    try {
      origin = new URL(src).origin;
    } catch {
      return;
    }
    const on = !!c;
    const ask = () => f.contentWindow?.postMessage({ type: AMBIENT_REQ, on }, origin);
    const ctx = c?.getContext('2d') ?? null;
    const tmp = document.createElement('canvas');
    const tctx = tmp.getContext('2d');
    let first = true;
    const onMsg = (e: MessageEvent) => {
      if (e.source !== f.contentWindow || e.origin !== origin) return;
      const d = e.data as { type?: unknown; ready?: unknown; off?: unknown; w?: unknown; h?: unknown; rgb?: unknown; bar?: unknown } | null;
      if (!d || d.type !== AMBIENT_MSG) return;
      if (d.ready) return ask();
      // Moon з панеллю «Під кадром» (його налаштування): рамка вища, див. .hp-watch__frame--below у style.css.
      if (typeof d.bar === 'string') return void f.parentElement?.classList.toggle('hp-watch__frame--below', d.bar === 'below');
      if (!c || !ctx || !tctx) return;
      if (d.off) return c.classList.remove('is-on');
      const w = Number(d.w);
      const h = Number(d.h);
      const rgb = d.rgb;
      if (typeof rgb !== 'string' || !(w > 0 && w <= 64 && h > 0 && h <= 64) || rgb.length !== w * h * 3) return;
      if (tmp.width !== w || tmp.height !== h) {
        tmp.width = c.width = w;
        tmp.height = c.height = h;
        first = true;
      }
      const img = tctx.createImageData(w, h);
      for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
        img.data[j] = rgb.charCodeAt(i);
        img.data[j + 1] = rgb.charCodeAt(i + 1);
        img.data[j + 2] = rgb.charCodeAt(i + 2);
        img.data[j + 3] = 255;
      }
      tctx.putImageData(img, 0, 0);
      // Плавна зміна кольорів: новий кадр поверх старого з прозорістю.
      ctx.globalAlpha = first ? 1 : 0.25;
      ctx.drawImage(tmp, 0, 0);
      if (first) c.classList.add('is-on');
      first = false;
    };
    window.addEventListener('message', onMsg);
    ask();
    return () => {
      window.removeEventListener('message', onMsg);
      f.parentElement?.classList.remove('hp-watch__frame--below');
      c?.classList.remove('is-on');
      if (!on) return;
      try {
        f.contentWindow?.postMessage({ type: AMBIENT_REQ, on: false }, origin);
      } catch {
        /* фрейм уже прибрано */
      }
    };
  }, [src, p.glow]);

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
      // За name скрипт entrypoints/player-frame.content.ts пізнає наш фрейм.
      name="hikka-plus"
      title={`${PLAYER_NAMES[p.player.kind]} — серія ${p.ep}`}
      allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
      allowFullScreen
      referrerPolicy="origin"
    />
  );
}
