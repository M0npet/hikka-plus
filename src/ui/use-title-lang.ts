import { useEffect, useState } from 'react';
import { titleLangItem, type TitleLang } from '../core/title-lang';

/** Мова назв користувача Hikka (src/core/title-lang.ts); змінилась — перемальовуємо. */
export function useTitleLang(): TitleLang {
  const [lang, setLang] = useState<TitleLang>('title_ua');
  useEffect(() => {
    let off = false;
    void titleLangItem.getValue().then((v) => !off && setLang(v));
    const unwatch = titleLangItem.watch((v) => setLang(v ?? 'title_ua'));
    return () => {
      off = true;
      unwatch();
    };
  }, []);
  return lang;
}
