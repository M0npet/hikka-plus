import { defineConfig } from 'wxt';
import { API_HOSTS } from './src/core/hosts';

// https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: ({ browser, manifestVersion }) => ({
    // Основна мова — українська (0.6.1, MK 2026-11-24: «розширення для українців»; з неї AMO бере мову сторінки за замовчуванням).
    // Тексти — public/_locales/{uk,en}/messages.json; інтерфейс самого розширення лише українською.
    default_locale: 'uk',
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    permissions: ['storage'],
    host_permissions: ['https://hikka.io/*', ...API_HOSTS.map((h) => `${h}/*`)],
    // Підсвітка пристроїв (src/lights/): адреса ТВ/моста/WLED у домашній мережі наперед невідома —
    // дозвіл на конкретний хост просимо кнопкою у вкладці «Плеєр»; Razer — localhost.
    // MV2 (Firefox) не знає optional_host_permissions — там хости йдуть в optional_permissions.
    ...(manifestVersion === 2
      ? { optional_permissions: ['http://*/*', 'https://*/*'] }
      : { optional_host_permissions: ['http://*/*', 'https://*/*'] }),
    // Скрипт-міст у контексті сторінки (entrypoints/hikka-bridge.ts) — лише для hikka.io.
    web_accessible_resources: [{ resources: ['hikka-bridge.js'], matches: ['https://hikka.io/*'] }],
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'hikka-plus@m0npet',
          // Вбудована згода Firefox на передачу даних (обов'язкова для AMO; PRIVACY.md — подробиці).
          // Обов'язкове: назви/slug тайтлу, який відкрито, ідуть джерелам, Mikai, AnimeON, AniSkip (browsingActivity).
          // Необов'язкові (0.6.1, MK 2026-11-25): вхід у Hikka — токен (authenticationInfo) і прочитане/переглянуте в список
          // Hikka (websiteActivity) — просимо при «Увійти» (requestHikkaData, src/core/hikka-auth.ts); кольори кадру на пристрої
          // підсвітки в локальній мережі (websiteContent) — кнопкою «Підключити».
          data_collection_permissions: {
            required: ['browsingActivity'],
            optional: ['authenticationInfo', 'websiteActivity', 'websiteContent'],
          },
          // Вбудована згода є з Firefox 140 (Android — 142); на старіших довелося б робити власне вікно згоди.
          strict_min_version: '140.0',
        },
        gecko_android: { strict_min_version: '142.0' },
      },
    }),
  }),
  zip: {
    // Архів вихідного коду йде рецензентам AMO — локальні секрети й нотатки туди не потрібні.
    excludeSources: ['.env*', 'CLAUDE.md'],
  },
  // Preact замість React (той самий код через alias): React-DOM — ~200 КБ у кожному content script, Preact — ~15 КБ.
  // Типи лишаються від React (tsc), у збірку йде preact/compat.
  vite: () => ({
    resolve: {
      alias: [
        { find: /^react-dom\/client$/, replacement: 'preact/compat/client' },
        { find: /^react-dom$/, replacement: 'preact/compat' },
        { find: /^react\/jsx-(dev-)?runtime$/, replacement: 'preact/jsx-runtime' },
        { find: /^react$/, replacement: 'preact/compat' },
      ],
    },
  }),
  webExt: {
    startUrls: ['https://hikka.io/novel'],
  },
});
