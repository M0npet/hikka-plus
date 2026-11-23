import { useEffect } from 'react';
import { storage } from '#imports';
import { logoutHikka, authErrorItem } from '../core/hikka-auth';
import { chapterKey } from '../core/store';
import {
  autoSyncItem,
  loadRemoteRead,
  setHikkaChapters,
  startHikkaLogin,
  useHikkaAuth,
  useRemoteRead,
} from './hikka-sync';
import { markReadUpTo, markUntrackedUpTo, maxReadLocal, titleStore, untrackedUpTo, type TitleState } from './title-state';
import { Button, Switch } from '../ui/kit';

const STATUS: Record<string, string> = {
  reading: 'Читаю',
  completed: 'Прочитано',
  planned: 'Заплановано',
  on_hold: 'Відкладено',
  dropped: 'Закинуто',
};

/**
 * Яке число Hikka вже звіряли з прогресом тут (`kind:slug` → N). Зберігається, а не лише в пам'яті:
 * інакше після F5 знята галочка повернулася б, якщо Hikka не зменшилась (вимкнене «Авто»).
 */
export const hikkaSeenItem = storage.defineItem<Record<string, number>>('local:hp:hikkaSeen', { fallback: {} });
const SEEN_MAX = 500;

/** Перший раз бачимо це число Hikka для тайтлу? Одразу запам'ятовує. */
async function firstSeen(id: string, n: number): Promise<boolean> {
  const seen = await hikkaSeenItem.getValue();
  if (seen[id] === n) return false;
  const next = { ...seen };
  delete next[id];
  next[id] = n; // в кінець — найсвіжіші; найстаріші відрізаємо
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - SEEN_MAX))) delete next[k];
  await hikkaSeenItem.setValue(next);
  return true;
}

/** Рядок синхронізації зі списком Hikka під прогресом тайтлу. */
export function HikkaSyncBar({ state: s }: { state: TitleState }) {
  const auth = useHikkaAuth();
  const remote = useRemoteRead();
  const { kind, slug } = s.page;

  // Після входу — одразу підтягнути стан списку.
  useEffect(() => {
    if (auth.connected && !remote) void loadRemoteRead(kind, slug);
  }, [auth.connected, remote, kind, slug]);

  const here = remote && remote.kind === kind && remote.slug === slug ? remote : null;
  const hikkaN = here?.status === 'ok' ? (here.read?.chapters ?? 0) : 0;
  // Розділи до hikkaN, які тут ще не позначені прочитаними.
  const behind =
    hikkaN > 0 &&
    Object.values(s.sources).some((st) =>
      st.chapters.some((c) => {
        const n = Number.parseFloat(c.number.replace(',', '.'));
        return Number.isFinite(n) && n <= hikkaN && !s.progress.chapters[chapterKey(c.number)]?.read;
      }),
    );
  // У списку Hikka прочитано більше — одразу відмічаємо 1–N тут, без питання (рішення MK).
  // Лише коли це число Hikka для тайтлу бачимо вперше: якщо користувач потім зніме галочку
  // (а Hikka ще не встигла зменшитись), не повертаємо її.
  useEffect(() => {
    if (hikkaN <= 0) return;
    void firstSeen(`${kind}:${slug}`, hikkaN).then((first) => {
      // Поки читали сховище, користувач міг перейти на інший тайтл — відмічаємо лише той самий.
      const cur = titleStore.get()?.page;
      if (first && behind && cur?.kind === kind && cur.slug === slug) void markReadUpTo(hikkaN);
    });
  }, [behind, kind, slug, hikkaN]);
  // Розділи ≤ N, яких тут ще не торкались (проміжні «34.5», джерело/команда завантажились пізніше),
  // відмічаємо завжди — не лише при першому баченні числа. Зняті вручну мають запис і лишаються.
  const untracked = hikkaN > 0 ? untrackedUpTo(s, hikkaN).length : 0;
  useEffect(() => {
    if (!untracked) return;
    const cur = titleStore.get()?.page;
    if (cur?.kind === kind && cur.slug === slug) void markUntrackedUpTo(hikkaN);
  }, [untracked, kind, slug, hikkaN]);

  if (!auth.configured) return null;

  if (!auth.connected) {
    return (
      <div className="hp-hikka">
        <span className="hp-grow hp-small hp-muted">
          {auth.error ?? 'Синхронізуй прочитане зі своїм списком на Hikka'}
        </span>
        <Button variant="secondary" size="sm" onClick={() => void startHikkaLogin()}>
          Підключити Hikka
        </Button>
      </div>
    );
  }

  const localN = maxReadLocal(s.progress);

  const info =
    here?.status === 'loading'
      ? 'Hikka: завантажую…'
      : here?.status === 'none'
        ? 'Hikka: тайтла немає у твоєму списку'
        : here?.status === 'error'
          ? `Hikka: помилка (${here.error})`
          : here?.read
            ? `Hikka: ${STATUS[here.read.status] ?? here.read.status} · ${here.read.chapters} розд.`
            : 'Hikka: підключено';

  return (
    <>
      {auth.error && <div className="hp-hikka hp-small hp-muted">{auth.error}</div>}
      <div className="hp-hikka">
        <span className="hp-grow hp-small hp-muted">{info}</span>
        {localN > hikkaN && here && here.status !== 'loading' && here.status !== 'error' && (
          <Button
            variant="ghost"
            size="sm"
            title="Записати номер останнього прочитаного розділу у твій список Hikka"
            onClick={() => void setHikkaChapters(kind, slug, localN, s.hikka?.chapters ?? null)}
          >
            Записати {localN} у Hikka
          </Button>
        )}
        <span className="hp-row hp-small hp-muted" title="Оновлювати лічильник у Hikka, коли дочитуєш розділ">
          <Switch
            label="Автоматично оновлювати лічильник у Hikka"
            checked={auth.autoSync}
            onChange={(v) => void autoSyncItem.setValue(v)}
          />
          Авто
        </span>
        <Button
          variant="ghost"
          size="sm"
          title="Відключити Hikka на цьому пристрої"
          onClick={() => {
            void logoutHikka();
            void authErrorItem.setValue(null);
          }}
        >
          Вийти
        </Button>
      </div>
    </>
  );
}
