/*
 * Background: кадри з блоку «Перегляд» → увімкнені пристрої. Немає кадрів 3 с (пауза, закрили вкладку) або прийшов stop —
 * пристрої повертаються у свій режим. Зміна налаштувань пристроїв — теж зупинка; наступний кадр запустить з новими.
 */
import { browser } from '#imports';
import { hueDriver, philipsDriver, razerDriver, wledDriver, type Driver } from './devices';
import { hostOrigins, lightsDataOk, lightsItem, RAZER_ORIGINS, type Frame, type LightsConf } from './types';

const IDLE_MS = 3000;

type Run = { d: Driver; ready: Promise<boolean>; busy: boolean; at: number };

let runs: Run[] | null = null;
let starting: Promise<Run[]> | null = null;
let lastFrame = 0;
let idle = 0;

async function allowed(origins: string[]) {
  try {
    return await browser.permissions.contains({ origins });
  } catch {
    return false;
  }
}

async function drivers(c: LightsConf): Promise<Driver[]> {
  const out: Driver[] = [];
  if (!(await lightsDataOk())) return out; // Firefox: немає згоди на передачу кольорів кадру
  if (c.philips?.on && (await allowed(hostOrigins(c.philips.host)))) out.push(philipsDriver(c.philips));
  if (c.wled?.on && (await allowed(hostOrigins(c.wled.host)))) out.push(wledDriver(c.wled));
  if (c.hue?.on && (await allowed(hostOrigins(c.hue.host)))) out.push(hueDriver(c.hue));
  if (c.razer?.on && (await allowed(RAZER_ORIGINS))) out.push(razerDriver());
  return out;
}

function startAll(): Promise<Run[]> {
  starting ??= (async () => {
    const list = await drivers(await lightsItem.getValue());
    const r = list.map<Run>((d) => ({
      d,
      busy: false,
      at: 0,
      ready: d.start().then(
        () => true,
        (e) => {
          console.warn(`[Hikka Plus] підсвітка пристроїв: ${d.name} не відповідає`, e);
          return false;
        },
      ),
    }));
    runs = r;
    starting = null;
    return r;
  })();
  return starting;
}

export async function stopLights() {
  clearInterval(idle);
  idle = 0;
  const r = runs ?? (starting ? await starting : null);
  runs = null;
  if (!r) return;
  await Promise.all(r.map(async (x) => ((await x.ready) ? x.d.stop().catch(() => null) : null)));
}

export async function onLightsFrame(f: Frame) {
  if (!(f.w > 0 && f.w <= 64 && f.h > 0 && f.h <= 64) || typeof f.rgb !== 'string' || f.rgb.length !== f.w * f.h * 3) return;
  lastFrame = Date.now();
  if (!idle) idle = setInterval(() => Date.now() - lastFrame > IDLE_MS && void stopLights(), 1000) as unknown as number;
  const r = runs ?? (await startAll());
  for (const x of r) {
    const now = Date.now();
    if (x.busy || now - x.at < x.d.minGap) continue;
    x.busy = true;
    x.at = now;
    void x.ready
      .then((ok) => (ok ? x.d.send(f) : undefined))
      .catch(() => null)
      .finally(() => (x.busy = false));
  }
}

/** Налаштування пристроїв змінились — зупинити поточну сесію. */
export function watchLightsConf() {
  lightsItem.watch(() => void stopLights());
}
