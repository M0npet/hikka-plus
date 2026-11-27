/*
 * Налаштування й список «Нові розділи» (chapter-alerts.ts): вкладка «Читалка» і верх вікна по іконці, коли є нові.
 * Вигляд і дозвіл на сповіщення — як у «Нові серії в озвучках» (src/watch/dub-settings.tsx).
 */
import { browser } from '#imports';
import { useEffect, useState } from 'react';
import { Button, Header, SwitchRow } from '../ui/kit';
import { IconClose } from '../ui/icons';
import { NOTES, ago, openTab, useNotesPerm } from '../watch/dub-settings';
import { getDubPrefs } from '../watch/dub-alerts';
import {
  CHAP_CHECK_MIN,
  DEFAULT_CHAP_PREFS,
  MAX_CHAP_TRACK,
  chapCheckItem,
  chapNew,
  chapPrefsItem,
  chapUrl,
  chapsItem,
  forgetChap,
  getChapPrefs,
  type ChapCheckRequest,
  type ChapCheckResult,
  type ChapMap,
  type ChapPrefs,
} from './chapter-alerts';

function useChaps(): ChapMap {
  const [v, setV] = useState<ChapMap>({});
  useEffect(() => {
    void chapsItem.getValue().then(setV);
    return chapsItem.watch((x) => setV(x ?? {}));
  }, []);
  return v;
}

function useChapPrefs(): [ChapPrefs, (p: Partial<ChapPrefs>) => void] {
  const [v, setV] = useState<ChapPrefs>(DEFAULT_CHAP_PREFS);
  useEffect(() => {
    void getChapPrefs().then(setV);
    return chapPrefsItem.watch((x) => setV({ ...DEFAULT_CHAP_PREFS, ...x }));
  }, []);
  return [v, (p) => void getChapPrefs().then((x) => chapPrefsItem.setValue({ ...x, ...p }))];
}

function ChapList({ chaps, onlyNew }: { chaps: ChapMap; onlyNew?: boolean }) {
  const rows = Object.entries(chaps)
    .filter(([, t]) => !onlyNew || chapNew(t) > 0)
    .sort(([, a], [, b]) => chapNew(b) - chapNew(a) || b.nu - a.nu);
  if (!rows.length) return null;
  return (
    <ul className="hp-set__list">
      {rows.map(([key, t]) => {
        const k = chapNew(t);
        return (
          <li key={key} className="hp-set__item hp-dub" data-new={k > 0 || undefined}>
            <a className="hp-grow hp-dub__link" href={chapUrl(key)} target="_blank" rel="noreferrer noopener" title="Відкрити тайтл на Hikka">
              <span className="hp-set__name hp-dub__name">{t.name}</span>
              <span className="hp-xs hp-muted hp-dub__meta">
                {t.sn}
                {t.t ? ` · ${t.t}` : ''} · {t.n} розд.
              </span>
            </a>
            {k > 0 && <span className="hp-dub__new">+{k}</span>}
            {!onlyNew && (
              <Button variant="ghost" size="xs" icon title="Не стежити" aria-label={`Не стежити: ${t.name}`} onClick={() => void forgetChap(key)}>
                <IconClose />
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Верх вікна по іконці: нові розділи, якщо є. */
export function ChapPopupNews() {
  const chaps = useChaps();
  const [p] = useChapPrefs();
  if (!p.on || !Object.values(chaps).some((t) => chapNew(t) > 0)) return null;
  return (
    <div className="hp-dub-news">
      <Header title="Нові розділи" />
      <ChapList chaps={chaps} onlyNew />
    </div>
  );
}

export function ChapFields({ mode }: { mode: 'popup' | 'page' }) {
  const [p, setP] = useChapPrefs();
  const chaps = useChaps();
  const [notesOk, recheck] = useNotesPerm();
  const [last, setLast] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    void chapCheckItem.getValue().then(setLast);
    return chapCheckItem.watch((v) => setLast(v ?? 0));
  }, []);
  const count = Object.keys(chaps).length;

  const setNotify = async (on: boolean) => {
    if (!on) {
      setP({ notify: false });
      // Дозвіл спільний з озвучками — забираємо, лише коли там теж вимкнено.
      if (!(await getDubPrefs()).notify) void browser.permissions.remove(NOTES).then(recheck, recheck);
      return;
    }
    if (mode === 'popup' && !notesOk) return openTab('reader');
    const ok = notesOk || (await browser.permissions.request(NOTES).catch(() => false));
    recheck();
    if (ok) setP({ notify: true });
  };

  const checkNow = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = (await browser.runtime.sendMessage({ type: 'hp-chaps', op: 'check' } satisfies ChapCheckRequest)) as ChapCheckResult;
      setMsg(r.error ?? (r.found ? `Нові розділи: ${r.found} тайтл.` : 'Нових розділів немає'));
    } catch {
      setMsg('Не вдалося перевірити');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SwitchRow
        label="Нові розділи"
        hint={`Раз на ${CHAP_CHECK_MIN / 60} год перевіряє тайтли, які ви читали в читалці (до ${MAX_CHAP_TRACK}): чи вийшов новий розділ на обраному джерелі. Zenko, Manga.in.ua, UAManga, Honey Manga, Бака, DGManga`}
        checked={p.on}
        onChange={(on) => setP({ on })}
      />
      {p.on && (
        <>
          <SwitchRow label="Число на іконці" hint="Скільки нових розділів ще не бачили (разом із серіями в озвучках)" checked={p.badge} onChange={(badge) => setP({ badge })} />
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
              <ChapList chaps={chaps} />
            ) : (
              <p className="hp-xs hp-muted hp-set__msg">Прочитайте розділ у читалці на сторінці манґи чи ранобе — тайтл з'явиться тут.</p>
            )}
          </div>
        </>
      )}
    </>
  );
}
