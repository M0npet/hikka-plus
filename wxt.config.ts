import { defineConfig } from 'wxt';
import { API_HOSTS } from './src/core/hosts';

// https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: ({ browser }) => ({
    name: 'Hikka Plus',
    description:
      'Читалка ранобе та манґи прямо на сторінці тайтлу hikka.io. Неофіційне розширення.',
    permissions: ['storage'],
    host_permissions: ['https://hikka.io/*', ...API_HOSTS.map((h) => `${h}/*`)],
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'hikka-plus@m0npet',
          // Firefox вимагає декларувати збір даних; ми нічого не збираємо.
          data_collection_permissions: { required: ['none'] },
        },
      },
    }),
  }),
  zip: {
    // Архів вихідного коду йде рецензентам AMO — локальні секрети й нотатки туди не потрібні.
    excludeSources: ['.env*', 'CLAUDE.md'],
  },
  webExt: {
    startUrls: ['https://hikka.io/novel'],
  },
});
