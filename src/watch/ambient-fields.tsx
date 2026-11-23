import { Slider } from '../ui/kit';
import { DEFAULT_AMBIENT_BRIGHT, DEFAULT_AMBIENT_LEVEL, type WatchPrefs } from './watch-store';

/**
 * Повзунки підсвітки — спільні для шестерні блоку «Перегляд» і вкладки «Плеєр» у вікні налаштувань.
 * Прозорість (MK 15:52, 16:07) — окремо від яскравості кольорів.
 */
export function AmbientFields({ prefs, onPrefs }: { prefs: WatchPrefs; onPrefs: (p: Partial<WatchPrefs>) => void }) {
  return (
    <>
      <Slider
        label="Прозорість підсвітки"
        value={100 - (prefs.ambientLevel ?? DEFAULT_AMBIENT_LEVEL)}
        min={0}
        max={90}
        step={5}
        format={(v) => `${v}%`}
        onChange={(t) => onPrefs({ ambientLevel: 100 - t })}
      />
      <Slider
        label="Яскравість підсвітки"
        value={prefs.ambientBright ?? DEFAULT_AMBIENT_BRIGHT}
        min={50}
        max={200}
        step={10}
        format={(v) => `${v}%`}
        onChange={(ambientBright) => onPrefs({ ambientBright })}
      />
    </>
  );
}
