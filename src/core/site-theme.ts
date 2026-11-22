/**
 * Тема Hikka для вікна налаштувань: content script на hikka.io запам'ятовує, яка тема й кольори
 * зараз у користувача (світла/темна, акцент, радіус — Hikka дозволяє їх змінювати), а popup і
 * вкладка налаштувань малюють себе так само. Поки hikka.io ще не відкривали — системна тема.
 */
import { storage } from '#imports';

/** Змінні теми Hikka, від яких залежать наші стилі (style.css: --hp-* ← ці). */
const VARS = [
  '--background',
  '--foreground',
  '--card',
  '--popover',
  '--primary',
  '--primary-foreground',
  '--primary-border',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--border',
  '--input',
  '--ring',
  '--surface',
  '--surface-inset',
  '--radius',
  '--destructive',
  '--destructive-foreground',
  '--destructive-border',
];

export interface SiteTheme {
  dark: boolean;
  vars: Record<string, string>;
}

export const siteThemeItem = storage.defineItem<SiteTheme | null>('local:hp:siteTheme', { fallback: null });

function capture(): SiteTheme {
  const cs = getComputedStyle(document.documentElement);
  const vars: Record<string, string> = {};
  for (const v of VARS) {
    const val = cs.getPropertyValue(v).trim();
    // Лише значення без посилань на інші змінні — у вікні налаштувань їх немає.
    if (val && !val.includes('var(') && val.length < 200) vars[v] = val;
  }
  return { dark: document.documentElement.classList.contains('dark'), vars };
}

/** Content script: зберігати тему Hikka зараз і щоразу, коли користувач її змінить. */
export function trackSiteTheme(onCleanup: (fn: () => void) => void) {
  let last = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const t = capture();
      if (!Object.keys(t.vars).length) return;
      const json = JSON.stringify(t);
      if (json === last) return;
      last = json;
      void siteThemeItem.setValue(t).catch(() => {});
    }, 400);
  };
  save();
  const obs = new MutationObserver(save);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
  obs.observe(document.head, { childList: true });
  onCleanup(() => {
    obs.disconnect();
    clearTimeout(timer);
  });
}
