/*
 * Мова назв як у користувача Hikka (MK 2026-11-26 14:03, ідея 4 з research-hikka-github.md).
 * Hikka: GET /user/me/ui → {preferences: {title_language: 'title_ua' | 'title_en' | 'title_ja' | 'title_original'}};
 * сторінка тримає це в кеші TanStack Query (`profileUi`, лише після входу) — міст (entrypoints/hikka-bridge.ts)
 * передає значення сюди, власних запитів немає. Без входу — як у Hikka за замовчуванням, українська.
 * Значення лежить у local: (спільне для вкладок). Назви озвучок для сповіщень (dub-alerts.ts) записуються вже цією мовою.
 */
import { storage } from '#imports';
import { ME_EVENT, TITLE_LANG_EVENT, TITLE_LANG_REQ } from './bridge';

export type TitleLang = 'title_ua' | 'title_en' | 'title_ja' | 'title_original';
const LANGS: TitleLang[] = ['title_ua', 'title_en', 'title_ja', 'title_original'];

export const titleLangItem = storage.defineItem<TitleLang>('local:hp:titleLang', { fallback: 'title_ua' });
/** Ім'я на Hikka з кешу сторінки (міст, ME_EVENT); '' — невідомо (не зайшли). Для «Далі з Дивлюсь» (src/watch/up-next.ts). */
export const hikkaMeItem = storage.defineItem<string>('local:hp:me', { fallback: '' });

/** Назви тайтлу/серії. Для аніме «оригінальна» — це title_ja (як getOriginalTitle у Hikka). */
type Titles = { ua?: string | null; en?: string | null; ja?: string | null };

/** Назва мовою користувача; немає — у порядку Hikka: укр → англ → оригінальна (яп). */
export function pickTitle(t: Titles, lang: TitleLang): string {
  const first = lang === 'title_en' ? t.en : lang === 'title_ja' || lang === 'title_original' ? t.ja : t.ua;
  return (first || t.ua || t.en || t.ja || '').trim();
}

/** Content script на hikka.io: слухати мову з кешу сторінки (міст) і зберігати, якщо змінилась. */
export function listenTitleLang() {
  document.addEventListener(TITLE_LANG_EVENT, (e) => {
    const v = (e as CustomEvent<unknown>).detail;
    if (typeof v !== 'string' || !LANGS.includes(v as TitleLang)) return;
    void titleLangItem.getValue().then((cur) => {
      if (cur !== v) return titleLangItem.setValue(v as TitleLang);
    });
  });
  document.addEventListener(ME_EVENT, (e) => {
    const v = (e as CustomEvent<unknown>).detail;
    if (typeof v !== 'string' || !/^[\w.-]{1,64}$/.test(v)) return;
    void hikkaMeItem.getValue().then((cur) => {
      if (cur !== v) return hikkaMeItem.setValue(v);
    });
  });
  document.dispatchEvent(new CustomEvent(TITLE_LANG_REQ));
}
