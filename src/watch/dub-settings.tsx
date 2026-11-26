/*
 * Налаштування й список «Нові серії в озвучках» (dub-alerts.ts): вкладка «Плеєр» і верх вікна по іконці, коли є нові.
 * Дозвіл notifications просимо по кліку першим у обробнику; у popup Firefox закриває вікно на запит дозволу → там «у вкладці».
 */
import { browser } from '#imports';
import { useEffect, useState } from 'react';
import { Button, Header, SwitchRow } from '../ui/kit';
import { IconClose } from '../ui/icons';
import {
  DEFAULT_DUB_PREFS,
  CHECK_EVERY_MIN,
  MAX_TRACK,
  dubCheckItem,
  dubNew,
  dubPrefsItem,
  dubsItem,
  forgetDub,
  getDubPrefs,
  type DubPrefs,
  type DubCheckRequest,
  type DubCheckResult,
  type DubMap,
} from './dub-alerts';

function useDubs(): DubMap {
  const [v, setV] = useState<DubMap>({});
  useEffect(() => {
    void dubsItem.getValue().then(setV);
    return dubsItem.watch((x) => setV(x ?? {}));
  }, []);
  return v;
}

function useDubPrefs(): [DubPrefs, (p: Partial<DubPrefs>) => void] {
  const [v, setV] = useState<DubPrefs>(DEFAULT_DUB_PREFS);
  useEffect(() => {
    void getDubPrefs().then(setV);
    return dubPrefsItem.watch((x) => setV({ ...DEFAULT_DUB_PREFS, ...x }));
  }, []);
  return [v, (p) => void getDubPrefs().then((x) => dubPrefsItem.setValue({ ...x, ...p }))];
}

const NOTES = { permissions: ['notifications'] } as Parameters<typeof browser.permissions.request>[0];

function useNotesPerm(): [boolean, () => void] {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const check = () => void browser.permissions.contains(NOTES).then(setOk, () => setOk(false));
    check();
    browser.permissions.onAdded?.addListener(check);
    browser.permissions.onRemoved?.addListener(check);
    return () => {
      browser.permissions.onAdded?.removeListener(check);
      browser.permissions.onRemoved?.removeListener(check);
    };
  }, []);
  return [ok, () => void browser.permissions.contains(NOTES).then(setOk)];
}

const openTab = () => {
  void browser.tabs.create({ url: `${browser.runtime.getURL('/options.html')}#player` });
  window.close();
};

function ago(ms: number) {
  if (!ms) return 'ще не перевіряли';
  const min = Math.round((Date.now() - ms) / 60_000);
  if (min < 1) return 'щойно';
  if (min < 60) return `${min} хв тому`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} год тому` : `${Math.round(h / 24)} дн. тому`;
}

/** Список тайтлів: спершу з новими серіями. onlyNew — лише вони (верх вікна по іконці). */
function DubList({ dubs, onlyNew }: { dubs: DubMap; onlyNew?: boolean }) {
  const rows = Object.entries(dubs)
    .filter(([, t]) => !onlyNew || dubNew(t) > 0)
    .sort(([, a], [, b]) => dubNew(b) - dubNew(a) || b.nu - a.nu);
  if (!rows.length) return null;
  return (
    <ul className="hp-set__list">
      {rows.map(([slug, t]) => {
        const k = dubNew(t);
        return (
          <li key={slug} className="hp-set__item hp-dub" data-new={k > 0 || undefined}>
            <a
              className="hp-grow hp-dub__link"
              href={`https://hikka.io/anime/${encodeURIComponent(slug)}`}
              target="_blank"
              rel="noreferrer noopener"
              title="Відкрити тайтл на Hikka"
            >
              <span className="hp-set__name hp-dub__name">{t.name}</span>
              <span className="hp-xs hp-muted hp-dub__meta">
                {t.tn} · {t.n} сер.
              </span>
            </a>
            {k > 0 && <span className="hp-dub__new">+{k}</span>}
            {!onlyNew && (
              <Button variant="ghost" size="xs" icon title="Не стежити" aria-label={`Не стежити: ${t.name}`} onClick={() => void forgetDub(slug)}>
                <IconClose />
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Верх вікна по іконці: нові серії, якщо є. */
export function DubPopupNews() {
  const dubs = useDubs();
  const [p] = useDubPrefs();
  if (!p.on || !Object.values(dubs).some((t) => dubNew(t) > 0)) return null;
  return (
    <div className="hp-dub-news">
      <Header title="Нові серії в озвучках" />
      <DubList dubs={dubs} onlyNew />
    </div>
  );
}

export function DubFields({ mode }: { mode: 'popup' | 'page' }) {
  const [p, setP] = useDubPrefs();
  const dubs = useDubs();
  const [notesOk, recheck] = useNotesPerm();
  const [last, setLast] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    void dubCheckItem.getValue().then(setLast);
    return dubCheckItem.watch((v) => setLast(v ?? 0));
  }, []);
  const count = Object.keys(dubs).length;

  const setNotify = async (on: boolean) => {
    if (!on) {
      setP({ notify: false });
      void browser.permissions.remove(NOTES).then(recheck, recheck);
      return;
    }
    if (mode === 'popup' && !notesOk) return openTab();
    // Запит дозволу — першим у обробнику кліку (інакше браузер не покаже вікно).
    const ok = notesOk || (await browser.permissions.request(NOTES).catch(() => false));
    recheck();
    if (ok) setP({ notify: true });
  };

  const checkNow = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = (await browser.runtime.sendMessage({ type: 'hp-dubs', op: 'check' } satisfies DubCheckRequest)) as DubCheckResult;
      setMsg(r.error ?? (r.found ? `Нові серії: ${r.found} тайтл.` : 'Нових серій немає'));
    } catch {
      setMsg('Не вдалося перевірити');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SwitchRow
        label="Нові серії в озвучках"
        hint={`Раз на ${CHECK_EVERY_MIN / 60} год перевіряє на Mikai тайтли, які ви дивились у плеєрі (до ${MAX_TRACK}): чи вийшла нова серія у вашої команди`}
        checked={p.on}
        onChange={(on) => setP({ on })}
      />
      {p.on && (
        <>
          <SwitchRow label="Число на іконці" hint="Скільки нових серій ще не бачили" checked={p.badge} onChange={(badge) => setP({ badge })} />
          <SwitchRow
            label="Сповіщення браузера"
            hint={mode === 'popup' && !notesOk ? 'Дозвіл на сповіщення — у вкладці налаштувань' : 'Браузер спитає дозвіл на сповіщення'}
            checked={p.notify && notesOk}
            onChange={(v) => void setNotify(v)}
          />
          <div className="hp-dub-box">
            <div className="hp-set__actions hp-dub-box__top">
              <span className="hp-xs hp-muted hp-grow">
                Стежимо: {count} · перевірено {ago(last)}
              </span>
              <Button size="sm" variant="secondary" disabled={busy || !count} onClick={() => void checkNow()}>
                {busy ? 'Перевіряю…' : 'Перевірити зараз'}
              </Button>
            </div>
            {msg && <p className="hp-xs hp-muted hp-set__msg">{msg}</p>}
            {count ? (
              <DubList dubs={dubs} />
            ) : (
              <p className="hp-xs hp-muted hp-set__msg">Подивіться серію в плеєрі на сторінці аніме — тайтл з'явиться тут.</p>
            )}
          </div>
        </>
      )}
    </>
  );
}
