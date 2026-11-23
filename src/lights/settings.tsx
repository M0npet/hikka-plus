/*
 * Вкладка «Плеєр» → «Підсвітка пристроїв»: картки Philips TV / WLED / Hue / Razer.
 * Дозвіл на хост пристрою просимо по кнопці (жест користувача) — тому permissions.request стоїть першим у обробнику.
 */
import { browser } from '#imports';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Switch } from '../ui/kit';
import { solid } from './color';
import {
  hueDriver,
  huePair,
  philipsDriver,
  philipsPairGrant,
  philipsPairRequest,
  razerDriver,
  wledDriver,
  type Driver,
  type PhilipsPairing,
} from './devices';
import { ljson } from './digest';
import { cleanHost, hostOrigins, lightsItem, RAZER_ORIGINS, type DeviceKind, type LightsConf, type RGB } from './types';

function useLights(): [LightsConf, (p: Partial<LightsConf>) => Promise<void>] {
  const [v, setV] = useState<LightsConf>({});
  useEffect(() => {
    void lightsItem.getValue().then(setV);
    return lightsItem.watch(setV);
  }, []);
  const set = async (p: Partial<LightsConf>) => {
    const nv = { ...(await lightsItem.getValue()), ...p };
    for (const k of Object.keys(p) as DeviceKind[]) if (p[k] === undefined) delete nv[k];
    setV(nv);
    await lightsItem.setValue(nv);
  };
  return [v, set];
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** «Перевірити»: червоний → зелений → синій, потім пристрій повертається у свій режим. */
async function testDriver(d: Driver) {
  await d.start();
  try {
    for (const c of [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
    ] as RGB[]) {
      await d.send(solid(c));
      await sleep(900);
    }
  } finally {
    await d.stop().catch(() => null);
  }
}

async function askHost(host: string) {
  return browser.permissions.request({ origins: hostOrigins(host) });
}

/** Одна картка пристрою: назва, вимикач (коли підключено), вміст, статус. */
function Card(p: { title: string; on?: boolean; onToggle?: (v: boolean) => void; children: ReactNode; msg?: string; err?: boolean }) {
  return (
    <div className="hp-lights__card">
      <div className="hp-lights__head">
        <span className="hp-set__name">{p.title}</span>
        {p.onToggle && <Switch checked={!!p.on} onChange={p.onToggle} label={`${p.title}: увімкнено`} />}
      </div>
      {p.children}
      {p.msg && <p className={p.err ? 'hp-small hp-set__error' : 'hp-small hp-muted hp-set__msg'}>{p.msg}</p>}
    </div>
  );
}

function useStatus() {
  const [s, setS] = useState<{ msg?: string; err?: boolean; busy?: boolean }>({});
  const run = async (busyMsg: string, fn: () => Promise<string | void>) => {
    setS({ msg: busyMsg, busy: true });
    try {
      const m = await fn();
      setS({ msg: m || undefined });
    } catch (e) {
      setS({ msg: errText(e), err: true });
    }
  };
  return { ...s, run, set: setS };
}

function HostInput(p: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      className="hp-input"
      value={p.value}
      onChange={(e) => p.onChange(e.target.value)}
      placeholder={p.placeholder}
      spellCheck={false}
      autoComplete="off"
    />
  );
}

/** Кнопки підключеного пристрою: «Перевірити» і «Забути». */
function Connected(p: { label: string; test: () => Promise<void>; forget: () => void; st: ReturnType<typeof useStatus> }) {
  return (
    <>
      <p className="hp-small hp-muted hp-set__msg">Підключено: {p.label}</p>
      <div className="hp-set__actions">
        <Button size="sm" disabled={p.st.busy} onClick={() => void p.st.run('Перевіряю: червоний → зелений → синій…', async () => {
          await p.test();
          return 'Перевірку завершено';
        })}>
          Перевірити
        </Button>
        <Button size="sm" variant="ghost" disabled={p.st.busy} onClick={p.forget}>
          Забути
        </Button>
      </div>
    </>
  );
}

function PhilipsCard({ conf, set }: { conf: LightsConf; set: (p: Partial<LightsConf>) => Promise<void> }) {
  const c = conf.philips;
  const st = useStatus();
  const [host, setHost] = useState('');
  const [pairing, setPairing] = useState<PhilipsPairing | null>(null);
  const [pin, setPin] = useState('');
  const h = cleanHost(host);

  const connect = async () => {
    if (!h) return st.set({ msg: 'Вкажіть IP телевізора, напр. 192.168.1.50', err: true });
    if (!(await askHost(h))) return st.set({ msg: 'Без дозволу на адресу ТВ підсвітка не працюватиме', err: true });
    await st.run('Звертаюсь до ТВ…', async () => {
      try {
        const r = await philipsPairRequest(h);
        if ('conf' in r) {
          await set({ philips: r.conf });
          return 'Підключено (старий API без входу)';
        }
        setPairing(r.pairing);
        return 'Введіть PIN з екрана телевізора';
      } catch (e) {
        throw new Error(
          `ТВ не відповідає (${errText(e)}). Android-ТВ: відкрийте https://${h}:1926 у цьому браузері, прийміть сертифікат і спробуйте ще раз.`,
        );
      }
    });
  };

  const grant = () =>
    pairing &&
    void st.run('Перевіряю PIN…', async () => {
      await set({ philips: await philipsPairGrant(pairing, pin.trim()) });
      setPairing(null);
      setPin('');
      return 'Підключено';
    });

  return (
    <Card
      title="Philips TV (Ambilight)"
      on={c?.on}
      onToggle={c ? (on) => void set({ philips: { ...c, on } }) : undefined}
      msg={st.msg}
      err={st.err}
    >
      {c ? (
        <Connected label={c.host} st={st} test={() => testDriver(philipsDriver(c))} forget={() => void set({ philips: undefined })} />
      ) : pairing ? (
        <div className="hp-lights__row">
          <HostInput value={pin} onChange={setPin} placeholder="PIN з екрана ТВ" />
          <Button size="sm" variant="default" disabled={st.busy || !/^\d{4,}$/.test(pin.trim())} onClick={grant}>
            Підтвердити
          </Button>
        </div>
      ) : (
        <>
          <div className="hp-lights__row">
            <HostInput value={host} onChange={setHost} placeholder="IP телевізора" />
            <Button size="sm" variant="default" disabled={st.busy} onClick={() => void connect()}>
              Підключити
            </Button>
          </div>
          <p className="hp-xs hp-muted hp-set__msg">
            Android-ТВ 2016+: спершу відкрийте{' '}
            {h ? (
              <a className="hp-link" href={`https://${h}:1926/6/system`} target="_blank" rel="noreferrer noopener">
                https://{h}:1926
              </a>
            ) : (
              'https://IP:1926'
            )}{' '}
            і прийміть сертифікат ТВ. Потім на екрані з'явиться PIN.
          </p>
        </>
      )}
    </Card>
  );
}

function WledCard({ conf, set }: { conf: LightsConf; set: (p: Partial<LightsConf>) => Promise<void> }) {
  const c = conf.wled;
  const st = useStatus();
  const [host, setHost] = useState('');
  const h = cleanHost(host);
  const connect = async () => {
    if (!h) return st.set({ msg: 'Вкажіть IP контролера WLED', err: true });
    if (!(await askHost(h))) return st.set({ msg: 'Без дозволу на адресу WLED підсвітка не працюватиме', err: true });
    await st.run('Звертаюсь до WLED…', async () => {
      const info = await ljson<{ leds?: { count?: number }; name?: string }>(`http://${h}/json/info`);
      await set({ wled: { host: h, on: true } });
      return `Підключено: ${info.name ?? 'WLED'}, світлодіодів: ${info.leds?.count ?? '?'}`;
    });
  };
  return (
    <Card title="WLED (LED-стрічка)" on={c?.on} onToggle={c ? (on) => void set({ wled: { ...c, on } }) : undefined} msg={st.msg} err={st.err}>
      {c ? (
        <Connected label={c.host} st={st} test={() => testDriver(wledDriver(c))} forget={() => void set({ wled: undefined })} />
      ) : (
        <div className="hp-lights__row">
          <HostInput value={host} onChange={setHost} placeholder="IP або wled.local" />
          <Button size="sm" variant="default" disabled={st.busy} onClick={() => void connect()}>
            Підключити
          </Button>
        </div>
      )}
      <p className="hp-xs hp-muted hp-set__msg">Стрічка навколо екрана від лівого нижнього кута вгору, за годинниковою стрілкою.</p>
    </Card>
  );
}

function HueCard({ conf, set }: { conf: LightsConf; set: (p: Partial<LightsConf>) => Promise<void> }) {
  const c = conf.hue;
  const st = useStatus();
  const [host, setHost] = useState('');
  const h = cleanHost(host);
  const connect = async () => {
    if (!h) return st.set({ msg: 'Вкажіть IP моста Hue', err: true });
    if (!(await askHost(h))) return st.set({ msg: 'Без дозволу на адресу моста підсвітка не працюватиме', err: true });
    await st.run('Звертаюсь до моста…', async () => {
      try {
        await set({ hue: { host: h, user: await huePair(h), on: true } });
        return 'Підключено';
      } catch (e) {
        if (errText(e) === 'link') throw new Error('Натисніть кнопку на мосту Hue і за 30 с ще раз «Підключити»');
        throw e;
      }
    });
  };
  return (
    <Card title="Philips Hue" on={c?.on} onToggle={c ? (on) => void set({ hue: { ...c, on } }) : undefined} msg={st.msg} err={st.err}>
      {c ? (
        <Connected label={c.host} st={st} test={() => testDriver(hueDriver(c))} forget={() => void set({ hue: undefined })} />
      ) : (
        <div className="hp-lights__row">
          <HostInput value={host} onChange={setHost} placeholder="IP моста Hue" />
          <Button size="sm" variant="default" disabled={st.busy} onClick={() => void connect()}>
            Підключити
          </Button>
        </div>
      )}
      <p className="hp-xs hp-muted hp-set__msg">Усі кольорові лампи — середній колір кадру, кілька разів на секунду (міст повільний).</p>
    </Card>
  );
}

function RazerCard({ conf, set }: { conf: LightsConf; set: (p: Partial<LightsConf>) => Promise<void> }) {
  const c = conf.razer;
  const st = useStatus();
  const connect = async () => {
    if (!(await browser.permissions.request({ origins: RAZER_ORIGINS })))
      return st.set({ msg: 'Без дозволу на localhost Razer Chroma не працюватиме', err: true });
    await st.run('Шукаю Razer Synapse…', async () => {
      await testDriver(razerDriver());
      await set({ razer: { on: true } });
      return 'Підключено';
    });
  };
  return (
    <Card title="Razer Chroma" on={c?.on} onToggle={c ? (on) => void set({ razer: { on } }) : undefined} msg={st.msg} err={st.err}>
      {c ? (
        <Connected label="Razer Synapse на цьому ПК" st={st} test={() => testDriver(razerDriver())} forget={() => void set({ razer: undefined })} />
      ) : (
        <div className="hp-set__actions">
          <Button size="sm" variant="default" disabled={st.busy} onClick={() => void connect()}>
            Підключити
          </Button>
        </div>
      )}
      <p className="hp-xs hp-muted hp-set__msg">Потрібен Razer Synapse з Chroma Connect. Усі пристрої — середній колір кадру.</p>
    </Card>
  );
}

/** Картки пристроїв. У popup Firefox закриває вікно на запит дозволу — тому там лише кнопка «у вкладці». */
export function DeviceLights({ mode }: { mode: 'popup' | 'page' }) {
  const [conf, set] = useLights();
  if (mode === 'popup')
    return (
      <div className="hp-set__actions">
        <Button
          size="sm"
          onClick={() => {
            void browser.tabs.create({ url: `${browser.runtime.getURL('/options.html')}#player` });
            window.close();
          }}
        >
          Налаштувати пристрої у вкладці
        </Button>
      </div>
    );
  return (
    <div className="hp-lights">
      <PhilipsCard conf={conf} set={set} />
      <WledCard conf={conf} set={set} />
      <HueCard conf={conf} set={set} />
      <RazerCard conf={conf} set={set} />
    </div>
  );
}
