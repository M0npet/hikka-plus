import './style.css';
import { browser, defineContentScript } from '#imports';
import { Mounter, mountOverlay } from '@/src/core/mount';
import { parseTitlePage } from '@/src/core/page';
import { ChaptersBlock } from '@/src/features/chapters-block';
import { ReadButton } from '@/src/features/read-button';
import { Reader } from '@/src/features/reader/reader';
import { initReaderUrl } from '@/src/features/reader-url';
import { loadTitle, readerStore, resetTitle } from '@/src/features/title-state';
import { AUTH_PATH } from '@/src/core/hikka-auth';
import { finishHikkaLogin } from '@/src/features/hikka-sync';

export default defineContentScript({
  matches: ['https://hikka.io/*'],
  cssInjectionMode: 'ui',
  runAt: 'document_idle',

  async main(ctx) {
    console.info('[Hikka Plus] content script запущено', browser.runtime.getManifest().version);
    // Повернення з підтвердження входу на Hikka.
    if (location.pathname === AUTH_PATH) {
      await finishHikkaLogin();
      return;
    }
    // Стан тайтлу береться з поточного шляху. Перевіряємо його ідемпотентно з кількох місць:
    // подія WXT про зміну адреси (через Navigation API) приходить ДО того, як location оновився,
    // тож самої події мало — додатково звіряємо шлях після мутацій DOM і раз на пів секунди.
    let lastPath: string | null = null;
    const syncPage = () => {
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      const page = parseTitlePage();
      if (page) void loadTitle(page);
      else resetTitle();
    };

    const mounter = new Mounter(ctx, [
      {
        name: 'hikka-plus-read-button',
        shouldMount: () => !!parseTitlePage(),
        anchors: [
          // Ліва колонка: під кнопкою «Додати у список».
          { selector: '#content-left-side > div:first-child', append: 'last' },
          { selector: '#content-left-side', append: 'first' },
        ],
        render: () => <ReadButton />,
      },
      {
        name: 'hikka-plus-chapters',
        shouldMount: () => !!parseTitlePage(),
        anchors: [
          // Центральна колонка: одразу після опису.
          { selector: '#content-description', append: 'after' },
          { selector: '#content-center', append: 'first' },
        ],
        render: () => <ChaptersBlock />,
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
