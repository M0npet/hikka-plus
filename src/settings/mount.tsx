import { createRoot } from 'react-dom/client';
import baseCss from '@/entrypoints/content/style.css?inline';
import { siteThemeItem, type SiteTheme } from '../core/site-theme';
import { ThemeRoot } from '../ui/kit';
import { SettingsApp, type SettingsMode } from './app';
import setCss from './settings.css?inline';

/**
 * Вікно налаштувань малюємо в Shadow DOM з тими самими стилями, що й на сайті (:host + hp-*),
 * щоб не дублювати CSS. Тема й кольори — як на Hikka у користувача (запам'ятовує content script,
 * `core/site-theme.ts`); поки hikka.io не відкривали — системна тема з палітрою Hikka за замовчуванням.
 * ThemeRoot стежить за класом dark на <html>, як і на сайті.
 */
// Палітра Hikka за замовчуванням (на сайті ці змінні задає сама Hikka; тут сторінки Hikka немає).
const THEME = `
:root{--radius:.625rem;color-scheme:light;
--background:oklch(100% 0 0);--foreground:oklch(14.1% .005 286);--card:oklch(100% 0 0);--popover:oklch(100% 0 0);
--secondary:oklch(96.7% .001 286);--secondary-foreground:oklch(21% .006 286);--muted:oklch(96.7% .001 286);
--muted-foreground:oklch(55.2% .016 286);--accent:oklch(96.7% .001 286);--border:oklch(92% .004 286);--input:oklch(92% .004 286);
--ring:oklch(70.5% .015 286);--surface:oklch(100% 0 0);
--primary:oklch(95% .034 343);--primary-foreground:oklch(50% .18 343);--primary-border:oklch(90% .063 343)}
:root.dark{color-scheme:dark;
--background:oklch(0% 0 0);--foreground:oklch(98.5% 0 0);--card:oklch(17% .006 286);--popover:oklch(14.2% .004 286);
--secondary:oklch(27.5% .006 286);--secondary-foreground:oklch(98.5% 0 0);--muted:oklch(27.5% .006 286);
--muted-foreground:oklch(71.3% .013 286);--accent:oklch(27.5% .006 286);--border:oklch(21.2% .004 286);--input:oklch(21.2% .004 286);
--ring:oklch(55.6% .006 286);--surface:oklch(18.7% .006 286 / .45);
--primary:oklch(15.6% .007 343);--primary-foreground:oklch(72.2% .18 343);--primary-border:oklch(27.7% .068 343)}
html,body{margin:0;background:var(--background)}`;

export function mountSettings(mode: SettingsMode) {
  const vars = document.createElement('style');
  vars.textContent = THEME;
  document.head.append(vars);
  const html = document.documentElement;
  const mq = matchMedia('(prefers-color-scheme: light)');
  let site: SiteTheme | null = null;
  const applyTheme = () => {
    html.classList.toggle('dark', site ? site.dark : !mq.matches);
    html.removeAttribute('style');
    for (const [k, v] of Object.entries(site?.vars ?? {})) html.style.setProperty(k, v);
  };
  applyTheme();
  mq.addEventListener('change', applyTheme);
  const useSite = (t: SiteTheme | null) => {
    site = t && typeof t === 'object' && t.vars ? t : null;
    applyTheme();
  };
  void siteThemeItem.getValue().then(useSite);
  siteThemeItem.watch(useSite);

  const host = document.getElementById('app')!;
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `${baseCss}\n${setCss}`;
  const root = document.createElement('div');
  shadow.append(style, root);
  createRoot(root).render(
    <ThemeRoot>
      <SettingsApp mode={mode} />
    </ThemeRoot>,
  );
}
