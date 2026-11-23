import './style.css';
import { browser, defineContentScript, injectScript } from '#imports';
import { Mounter, mountOverlay } from '@/src/core/mount';
import { parseAnimePage, parseTitlePage } from '@/src/core/page';
import { AnimeWatch, animePageStore } from '@/src/watch/watch-root';
import { ChaptersBlock } from '@/src/features/chapters-block';
import { ReadButton } from '@/src/features/read-button';
import { Reader } from '@/src/features/reader/reader';
import { initReaderUrl } from '@/src/features/reader-url';
import { loadTitle, readerStore, resetTitle } from '@/src/features/title-state';
import { AUTH_PATH } from '@/src/core/hikka-auth';
import { finishHikkaLogin } from '@/src/features/hikka-sync';
import { initSourcePrefs, watchSourcePrefs } from '@/src/core/source-prefs';
import { trackSiteTheme } from '@/src/core/site-theme';
import { getSettings, watchSettings } from '@/src/core/store';

export default defineContentScript({
  matches: ['https://hikka.io/*'],
  cssInjectionMode: 'ui',
  runAt: 'document_idle',

  async main(ctx) {
    console.info('[Hikka Plus] content script запущено', browser.runtime.getManifest().version);
    // Міст у контекст сторінки: після запису в список Hikka оновлює її власний кеш (лічильник зліва).
    void injectScript('/hikka-bridge.js', { keepInDom: true }).catch(() => {});
    // Повернення з підтвердження входу на Hikka.
    if (location.pathname === AUTH_PATH) {
      await finishHikkaLogin();
      return;
    }
    // Тема й акцент Hikka — щоб вікно налаштувань розширення виглядало так само.
    trackSiteTheme((fn) => ctx.onInvalidated(fn));
    // Увімкнені джерела та їх порядок (вікно налаштувань розширення).
    await initSourcePrefs();
    // Читалку можна вимкнути у вікні налаштувань — тоді ні кнопки, ні блоку, ні запитів до джерел.
    let readerOn = (await getSettings()).enabled;
    // Стан тайтлу береться з поточного шляху. Перевіряємо його ідемпотентно з кількох місць:
    // подія WXT про зміну адреси (через Navigation API) приходить ДО того, як location оновився,
    // тож самої події мало — додатково звіряємо шлях після мутацій DOM і раз на пів секунди.
    let lastPath: string | null = null;
    const syncPage = () => {
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      animePageStore.set(parseAnimePage()?.slug ?? null);
      const page = readerOn ? parseTitlePage() : null;
      if (page) void loadTitle(page);
      else resetTitle();
    };

    const mounter = new Mounter(ctx, [
      {
        name: 'hikka-plus-read-button',
        shouldMount: () => readerOn && !!parseTitlePage(),
        anchors: [
          // Ліва колонка: під кнопкою «Додати у список».
          { selector: '#content-left-side > div:first-child', append: 'last' },
          { selector: '#content-left-side', append: 'first' },
        ],
        render: () => <ReadButton />,
      },
      {
        name: 'hikka-plus-chapters',
        shouldMount: () => readerOn && !!parseTitlePage(),
        anchors: [
          // Центральна колонка: одразу після опису.
          { selector: '#content-description', append: 'after' },
          { selector: '#content-center', append: 'first' },
        ],
        render: () => <ChaptersBlock />,
      },
      {
        // Плеєр аніме: між «Опис» і «Головні персонажі».
        name: 'hikka-plus-watch',
        shouldMount: () => !!parseAnimePage(),
        anchors: [
          { selector: '#content-description', append: 'after' },
          { selector: '#content-characters', append: 'before' },
          { selector: '#content-center', append: 'first' },
        ],
        render: () => <AnimeWatch />,
      },
    ]);

    initReaderUrl((cb) => {
      ctx.addEventListener(window, 'popstate', cb);
      ctx.addEventListener(window, 'hashchange', cb);
    });
    syncPage();
    mounter.start();
    const onNav = () => {
      syncPage();
      mounter.schedule();
    };
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      // Адреса ще стара — перевіряємо після того, як навігація завершиться.
      setTimeout(onNav, 0);
      setTimeout(onNav, 150);
    });
    ctx.addEventListener(window, 'popstate', onNav);
    const pathObs = new MutationObserver(syncPage);
    pathObs.observe(document.body, { childList: true, subtree: true });
    ctx.onInvalidated(() => pathObs.disconnect());
    ctx.setInterval(onNav, 500);

    // Джерела ввімкнули/вимкнули чи переставили у вікні налаштувань — перезавантажити блок тайтлу
    // (якщо читалка відкрита, зміни підхопляться при наступному переході).
    const unPrefs = watchSourcePrefs(() => {
      if (readerStore.get()) return;
      resetTitle();
      lastPath = null;
      syncPage();
    });
    ctx.onInvalidated(unPrefs);
    ctx.onInvalidated(
      watchSettings((s) => {
        if (s.enabled === readerOn) return;
        readerOn = s.enabled;
        if (!readerOn && readerStore.get()) readerStore.set(null);
        resetTitle();
        lastPath = null;
        syncPage();
        mounter.schedule();
      }),
    );

    // Читалка — оверлей, відкривається на запит із кнопки/блоку.
    let removeReader: (() => void) | null = null;
    let opening = false;
    const syncReader = async () => {
      const req = readerStore.get();
      if (req && !removeReader && !opening) {
        opening = true;
        removeReader = await mountOverlay(ctx, <Reader />);
        opening = false;
        if (!readerStore.get()) syncReader();
      } else if (!req && removeReader) {
        removeReader();
        removeReader = null;
      }
    };
    const unsub = readerStore.subscribe(() => void syncReader());
    ctx.onInvalidated(() => {
      unsub();
      removeReader?.();
    });
  },
});
