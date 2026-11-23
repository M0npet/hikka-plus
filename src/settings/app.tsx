/**
 * Вікно налаштувань Hikka Plus: по іконці розширення (popup) і окремою вкладкою (options).
 * Розділи: Джерела, Hikka (вхід і синхронізація), Читалка, Плеєр, Дані. Компоненти — ті самі, що на сайті (ui/kit).
 */
import { browser } from '#imports';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { authErrorItem, hikkaConfigured, oauthUrl, returnItem, tokenItem } from '../core/hikka-auth';
import { applySourcePrefs, initSourcePrefs, setSourcePrefs, watchSourcePrefs, type SourcePrefs } from '../core/source-prefs';
import { DEFAULT_SETTINGS, updateSettings, useSettings } from '../core/store';
import { syncOnItem } from '../core/sync-flag';
import { MangaFields, NovelFields } from '../features/reader/settings-panel';
import { autoSyncItem } from '../features/hikka-sync';
import { DEFAULT_WIDE_ANIM, SCAN_HINT, useWatchPrefs } from '../watch/watch-store';
import { useCardsPrefs } from '../cards/prefs';
import { AmbientFields } from '../watch/ambient-fields';
import { DeviceLights } from '../lights/settings';
import { LINK_SOURCES } from '../sources/links';
import { SOURCES } from '../sources/registry';
import { IconExternal, IconLeft, IconReset, IconRight } from '../ui/icons';
import { Button, Header, Slider, Switch, SwitchRow, Tabs } from '../ui/kit';
import { dataStats, exportData, importData, resetAll, resetBindings, resetProgress, type DataStats } from './data';

export type SettingsMode = 'popup' | 'page';

/** Репозиторій розширення (MK 2026-11-23: посилання, версія й розробник у вікні налаштувань). */
const REPO_URL = 'https://github.com/M0npet/hikka-plus';
type Section = 'sources' | 'hikka' | 'reader' | 'player' | 'data';

const SECTIONS: [Section, string][] = [
  ['sources', 'Джерела'],
  ['hikka', 'Hikka'],
  ['reader', 'Читалка'],
  ['player', 'Плеєр'],
  ['data', 'Дані'],
];

function useItem<T>(item: { getValue(): Promise<T>; watch(cb: (v: T) => void): () => void }, fallback: T): T {
  const [v, setV] = useState<T>(fallback);
  useEffect(() => {
    void item.getValue().then(setV);
    return item.watch(setV);
  }, [item]);
  return v;
}

export function SettingsApp({ mode }: { mode: SettingsMode }) {
  const initial = (location.hash.slice(1) as Section) || 'sources';
  const [section, setSection] = useState<Section>(SECTIONS.some(([s]) => s === initial) ? initial : 'sources');
  const version = browser.runtime.getManifest().version;

  return (
    <div className={`hp-set hp-set--${mode}`}>
      <div className="hp-set__top">
        <div className="hp-set__brand">
          Hikka Plus <span className="hp-xs hp-muted">v{version}</span>
        </div>
        {mode === 'popup' && (
          <Button
            variant="ghost"
            size="sm"
            title="Відкрити налаштування в окремій вкладці"
            onClick={() => {
              void browser.runtime.openOptionsPage();
              window.close();
            }}
          >
            <IconExternal />
            У вкладці
          </Button>
        )}
      </div>
      <Tabs value={section} options={SECTIONS} onChange={setSection} label="Розділ налаштувань" />
      <div className="hp-set__body">
        {section === 'sources' && <SourcesSection />}
        {section === 'hikka' && <HikkaSection mode={mode} />}
        {section === 'reader' && <ReaderSection />}
        {section === 'player' && <PlayerFields mode={mode} />}
        {section === 'data' && <DataSection mode={mode} />}
      </div>
      <p className="hp-xs hp-muted hp-set__foot">
        Hikka Plus v{version} · розробник M0npet ·{' '}
        <a className="hp-link" href={REPO_URL} target="_blank" rel="noreferrer noopener">
          GitHub
        </a>{' '}
        ·{' '}
        <a className="hp-link" href={`${REPO_URL}/blob/main/PRIVACY.md`} target="_blank" rel="noreferrer noopener">
          Політика приватності
        </a>
        <br />
        Неофіційне розширення для hikka.io. Не пов'язане з командою Hikka.
      </p>
    </div>
  );
}

/* ---------- Джерела ---------- */

const KIND: Record<string, string> = { manga: 'Манґа', novel: 'Ранобе' };

function useSourcePrefs(): SourcePrefs | null {
  const [p, setP] = useState<SourcePrefs | null>(null);
  useEffect(() => {
    void initSourcePrefs().then(setP);
    return watchSourcePrefs((v) => setP({ ...v }));
  }, []);
  return p;
}

function SourcesSection() {
  const p = useSourcePrefs();
  if (!p) return null;
  const list = applySourcePrefs(SOURCES, p, true);
  const toggle = (id: string, on: boolean) =>
    setSourcePrefs((x) => ({ ...x, off: on ? x.off.filter((o) => o !== id) : [...new Set([...x.off, id])] }));
  const move = (i: number, d: -1 | 1) => {
    const ids = list.map((s) => s.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void setSourcePrefs((x) => ({ ...x, order: ids }));
  };

  return (
    <>
      <Header title="Читалка" count={list.length}>
        <Button
          variant="ghost"
          size="sm"
          title="Увімкнути всі джерела й повернути порядок за замовчуванням"
          onClick={() => void setSourcePrefs(() => ({ off: [], order: [] }))}
        >
          <IconReset />
          Скинути
        </Button>
      </Header>
      <p className="hp-xs hp-muted hp-set__hint">
        Порядок — пріоритет, коли для тайтлу ще не обрано джерело. У вимкнених джерелах тайтли не шукаються.
      </p>
      <ul className="hp-set__list">
        {list.map((s, i) => {
          const on = !p.off.includes(s.id);
          return (
            <li key={s.id} className="hp-set__item" data-off={!on || undefined}>
              <span className="hp-set__move">
                <Button variant="ghost" size="xs" icon title="Вище" aria-label={`${s.name} вище`} disabled={i === 0} onClick={() => move(i, -1)}>
                  <IconLeft className="hp-icon hp-set__up" />
                </Button>
                <Button variant="ghost" size="xs" icon title="Нижче" aria-label={`${s.name} нижче`} disabled={i === list.length - 1} onClick={() => move(i, 1)}>
                  <IconRight className="hp-icon hp-set__up" />
                </Button>
              </span>
              <span className="hp-grow">
                <span className="hp-set__name">{s.name}</span>
                <span className="hp-xs hp-muted"> {s.kinds.map((k) => KIND[k]).join(' · ')}</span>
              </span>
              <Switch label={`${s.name}: ${on ? 'увімкнено' : 'вимкнено'}`} checked={on} onChange={(v) => void toggle(s.id, v)} />
            </li>
          );
        })}
      </ul>

      <Header title="Лише посилання" count={LINK_SOURCES.length} />
      <p className="hp-xs hp-muted hp-set__hint">
        Сайти із захищеною читалкою: Hikka Plus лише знаходить тайтл і показує кнопку «Відкрити на …».
      </p>
      <ul className="hp-set__list">
        {LINK_SOURCES.map((s) => {
          const on = !p.off.includes(s.id);
          return (
            <li key={s.id} className="hp-set__item" data-off={!on || undefined}>
              <span className="hp-grow">
                <span className="hp-set__name">{s.name}</span>
                <span className="hp-xs hp-muted"> {s.kinds.map((k) => KIND[k]).join(' · ')}</span>
              </span>
              <Switch label={`${s.name}: ${on ? 'увімкнено' : 'вимкнено'}`} checked={on} onChange={(v) => void toggle(s.id, v)} />
            </li>
          );
        })}
      </ul>
    </>
  );
}

/* ---------- Hikka і синхронізація ---------- */

function HikkaSection({ mode }: { mode: SettingsMode }) {
  const token = useItem(tokenItem, null);
  const error = useItem(authErrorItem, null);
  const autoSync = useItem(autoSyncItem, true);
  const syncOn = useItem(syncOnItem, true);

  const login = async () => {
    await returnItem.setValue('/');
    await authErrorItem.setValue(null);
    await browser.tabs.create({ url: oauthUrl() });
    if (mode === 'popup') window.close();
  };

  return (
    <>
      <Header title="Акаунт Hikka" />
      {!hikkaConfigured() ? (
        <p className="hp-small hp-muted hp-set__hint">Ця збірка без клієнта Hikka — вхід недоступний.</p>
      ) : token ? (
        <>
          <div className="hp-set__item">
            <span className="hp-grow hp-small">Підключено на цьому пристрої</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void tokenItem.setValue(null);
                void authErrorItem.setValue(null);
              }}
            >
              Вийти
            </Button>
          </div>
          <SwitchRow
            label="Оновлювати лічильник у Hikka"
            hint="Дочитав розділ — у твоєму списку Hikka стає стільки ж розділів"
            checked={autoSync}
            onChange={(v) => void autoSyncItem.setValue(v)}
          />
        </>
      ) : (
        <div className="hp-set__item">
          <span className="hp-grow hp-small hp-muted">Підключи свій список Hikka, щоб прочитане записувалося туди</span>
          <Button variant="default" size="sm" onClick={() => void login()}>
            Увійти
          </Button>
        </div>
      )}
      {error && <p className="hp-small hp-set__error">{error}</p>}

      <Header title="Між пристроями" />
      <SwitchRow
        label="Синхронізація"
        hint="Прогрес, обрані джерела й налаштування — через акаунт браузера (Firefox Sync / Google). Без нашого сервера."
        checked={syncOn}
        onChange={(v) => void syncOnItem.setValue(v)}
      />
    </>
  );
}

/* ---------- Читалка ---------- */

function ReaderSection() {
  const s = useSettings();
  const [tab, setTab] = useState<'novel' | 'manga' | 'webtoon'>('novel');
  return (
    <>
      <Header title="Читалка">
        <Button
          variant="ghost"
          size="sm"
          title="Повернути всі налаштування читалки за замовчуванням"
          onClick={() => void updateSettings(() => DEFAULT_SETTINGS)}
        >
          <IconReset />
          Скинути
        </Button>
      </Header>
      <div className="hp-set__fields">
        <SwitchRow
          label="Показувати читалку"
          hint="Кнопка «Читати» і блок «Розділи» на сторінках манґи й ранобе"
          checked={s.enabled}
          onChange={(enabled) => void updateSettings((x) => ({ ...x, enabled }))}
        />
      </div>
      <Tabs
        value={tab}
        options={[
          ['novel', 'Ранобе'],
          ['manga', 'Манґа'],
          ['webtoon', 'Манхва'],
        ]}
        onChange={setTab}
        label="Тип читалки"
      />
      <div className="hp-set__fields">
        {tab === 'novel' ? (
          <NovelFields n={s.novel} />
        ) : (
          // Режим і ширина — свої для манґи й манхви; решта полів (зони, якість, яскравість…) спільні.
          <>
          <p className="hp-small hp-muted">Режим і ширина — окремо для манґи й манхви, решта налаштувань спільна.</p>
          <MangaFields
            key={tab}
            m={s.manga}
            modes={[tab === 'manga' ? ['modeManga', 'Режим читання'] : ['modeWebtoon', 'Режим читання (манхва й маньхуа)']]}
            widths={[tab === 'manga' ? 'width' : 'widthWebtoon']}
          />
          </>
        )}
        <SwitchRow
          label="Ховати панелі при прокрутці"
          hint="З'являються знову при прокрутці вгору або кліку"
          checked={s.autoHideBars}
          onChange={(autoHideBars) => void updateSettings((x) => ({ ...x, autoHideBars }))}
        />
      </div>
    </>
  );
}

/** Плеєр аніме (блок «Перегляд» на сторінці аніме). */
/** Плашки на картках аніме (src/cards/): «▶ N нових», «N серія через X дн.». */
function CardsFields() {
  const [c, setC] = useCardsPrefs();
  return (
    <>
      <SwitchRow
        label="Плашки на картках"
        hint="«▶ N нових» на тайтлах, які ви дивитесь (каталог, календар, ваші списки на Hikka)"
        checked={c.on}
        onChange={(on) => setC({ on })}
      />
      {c.on && (
        <SwitchRow label="Коли наступна серія" hint="«N серія через X дн.» за розкладом Hikka" checked={c.next} onChange={(next) => setC({ next })} />
      )}
    </>
  );
}

function PlayerFields({ mode }: { mode: SettingsMode }) {
  const [w, setW] = useWatchPrefs();
  return (
    <>
      <Header title="Плеєр аніме" />
      <div className="hp-set__fields">
        <SwitchRow
          label="Показувати плеєр"
          hint="Блок «Перегляд» на сторінці аніме: серії з Mikai та AnimeON"
          checked={w.enabled}
          onChange={(enabled) => setW({ enabled })}
        />
        <CardsFields />
        <SwitchRow
          label="На всю ширину"
          hint="Режим «Ширше»: блок на всю ширину сторінки під верхніми картками; запам'ятовується між тайтлами"
          checked={!!w.wide}
          onChange={(wide) => setW({ wide })}
        />
        <Slider
          label="Анімація «Ширше»"
          value={w.wideAnim ?? DEFAULT_WIDE_ANIM}
          min={0}
          max={800}
          step={40}
          format={(v) => (v ? `${v} мс` : 'вимк.')}
          onChange={(wideAnim) => setW({ wideAnim })}
        />
        <SwitchRow label="Автоперехід" hint="Наступна серія після кінця поточної" checked={w.autoNext} onChange={(autoNext) => setW({ autoNext })} />
        <SwitchRow
          label="Мітки опенінгу й ендингу"
          hint="Смужка під плеєром і кнопка «Пропустити». Якщо плеєр не дає міток, Hikka Plus сам знаходить OP/ED, порівнюючи кадри серій (лише на вашому пристрої)"
          checked={w.marks !== false}
          onChange={(marks) => setW({ marks })}
        />
        {w.marks !== false && (
          <>
            <SwitchRow label="Пропускати опенінг сам" checked={!!w.skipOp} onChange={(skipOp) => setW({ skipOp })} />
            <SwitchRow label="Пропускати ендинг сам" hint="Серія все одно зараховується" checked={!!w.skipEd} onChange={(skipEd) => setW({ skipEd })} />
            <SwitchRow label="Сканувати серії наперед" hint={SCAN_HINT} checked={w.scan !== false} onChange={(scan) => setW({ scan })} />
          </>
        )}
        <SwitchRow
          label="Підсвітка"
          hint="Кольори з відео навколо плеєра, як Ambient mode на YouTube"
          checked={w.ambient !== false}
          onChange={(ambient) => setW({ ambient })}
        />
        {w.ambient !== false && (
          <AmbientFields prefs={w} onPrefs={setW} />
        )}
        <SwitchRow
          label="Підсвітка пристроїв (експериментально)"
          hint="Кольори з відео на Philips TV Ambilight, WLED, Philips Hue, Razer Chroma у вашій мережі. Перевірено лише за документацією"
          checked={!!w.devices}
          onChange={(devices) => setW({ devices })}
        />
        {w.devices && <DeviceLights mode={mode} />}
        <SwitchRow
          label="Відмічати серії в Hikka"
          hint="Серія зараховується, коли дійшли до ендингу (або за 1:30 до кінця)"
          checked={w.hikkaSync}
          onChange={(hikkaSync) => setW({ hikkaSync })}
        />
      </div>
    </>
  );
}

/* ---------- Дані ---------- */

/** Кнопка небезпечної дії: перше натискання — «Точно?», друге — виконати. */
function ConfirmButton({ children, onConfirm }: { children: ReactNode; onConfirm: () => Promise<void> }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button
      variant={armed ? 'destructive-solid' : 'destructive'}
      size="sm"
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        void onConfirm();
      }}
    >
      {armed ? 'Точно? Натисни ще раз' : children}
    </Button>
  );
}

function DataSection({ mode }: { mode: SettingsMode }) {
  const [stats, setStats] = useState<DataStats | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () => void dataStats().then(setStats);
  useEffect(refresh, []);

  const done = (text: string) => {
    setMsg(text);
    refresh();
  };

  const doExport = async () => {
    const { name, json } = await exportData();
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setMsg(`Збережено ${name}`);
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const n = await importData(await f.text());
      done(`Відновлено записів: ${n}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <Header title="Дані на цьому пристрої" />
      <p className="hp-small hp-muted hp-set__hint">
        {stats ? `Тайтлів із прогресом: ${stats.progress} · з вибором джерела: ${stats.bindings}` : '…'}
      </p>

      <Header title="Резервна копія" />
      <p className="hp-xs hp-muted hp-set__hint">Прогрес, вибір джерел і налаштування у файлі JSON. Вхід у Hikka в копію не йде.</p>
      <div className="hp-set__actions">
        <Button variant="secondary" size="sm" onClick={() => void doExport()}>
          Зберегти копію
        </Button>
        {mode === 'page' ? (
          <>
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
              Відновити з файлу
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                void onFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </>
        ) : (
          // Вибір файлу закриває popup (особливо у Firefox) — відновлюємо у вкладці.
          <Button
            variant="secondary"
            size="sm"
            title="Відкриється у вкладці: з маленького вікна браузер не дає вибрати файл"
            onClick={() => {
              void browser.tabs.create({ url: `${browser.runtime.getURL('/options.html')}#data` });
              window.close();
            }}
          >
            Відновити з файлу
            <IconExternal />
          </Button>
        )}
      </div>

      <Header title="Скинути" />
      <p className="hp-xs hp-muted hp-set__hint">
        Видаляє з цього пристрою і зі синхронізації. Якщо на іншому пристрої дані лишилися, вони можуть повернутися звідти.
      </p>
      <div className="hp-set__actions">
        <ConfirmButton onConfirm={() => resetProgress().then(() => done('Прогрес скинуто'))}>Прогрес читання</ConfirmButton>
        <ConfirmButton onConfirm={() => resetBindings().then(() => done('Вибір джерел скинуто'))}>Вибір джерел</ConfirmButton>
        <ConfirmButton onConfirm={() => resetAll().then(() => done('Усе скинуто (крім входу в Hikka)'))}>Усе</ConfirmButton>
      </div>
      {msg && <p className="hp-small hp-set__msg">{msg}</p>}
    </>
  );
}
