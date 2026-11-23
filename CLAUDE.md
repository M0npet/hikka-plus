# Hikka Plus — правила для Claude

Розширення для hikka.io (WXT 0.21 + React 19 + TypeScript, MV3 для Chrome, MV2 для Firefox).
Карта проєкту й рішення MK — у claude.ai-проєкті «Hikka The Project» (`claude/project-map.md`,
`claude/research-readers-and-layout.md`).

## Рішення MK (не порушувати)
- Усе вбудовано в сайт і в його стилі; блок розділів і кнопка — на сторінці тайтлу, читалка — оверлей.
- Джерела — **тільки українські**: Zenko, manga.in.ua, baka.in.ua, Honey Manga, UAManga, DGManga, Animesvit, Смаколики, Runi, NovelHub (novel.org.ua; роботи 18+ сайт віддає лише після входу — не показуємо), FanVers (fan-vers.com, лише переклади), Wattpad (лише історії українською, language 46; платні — ні). Захист читалки (токени, nonce, Referer) не обходимо — такі сайти лише посиланням: `src/sources/links.ts` (Mangra — точно за `hikkaSlug`, FAUST і Mangarama — публічний пошук, Dengeki — посилання на пошук; спершу завжди посилання з блоку «Читати» на Hikka), UI — `src/features/external-links.tsx`. Повний список сайтів і чому деякі не підключені — `claude/sources-ua.md` у claude.ai-проєкті. Senkuro — лише зразок UX.
- Без власного сервера. Віддалено можна оновлювати лише дані (JSON), не код (політики AMO/CWS).
- Не заважати Hikka Features і Hikka Forge: тільки свій Shadow DOM з тегами `hikka-plus-*`,
  класи `hp-*`, чужий DOM не змінювати, клавіші перехоплювати лише при відкритій читалці.
- «Свої тайтли в каталозі» — відкладено, не робити.
- Назва: Hikka Plus, неофіційне; не видавати себе за Hikka.

## Структура
- `entrypoints/background.ts` — fetch за allowlist (`src/core/hosts.ts`), CORS обходимо тут.
- `entrypoints/content/` — монтування блоків (`src/core/mount.ts`, self-healing для SPA), стилі `style.css`.
  Зміну сторінки в SPA перевіряти за `location.pathname` ідемпотентно: подія `wxt:locationchange` (Navigation API) приходить ДО оновлення адреси.
- `src/features/title-state.ts` — спільний стан тайтлу (кнопка, блок, читалка).
- `src/sources/` — джерела (`ReadSource`), автопідбір (`match.ts`, `autoMatchBy` — спільний для нових джерел; підсумок завжди через `settleMatch`: кандидат 0.45–0.8 → підказка «Схоже» в блоці, прив'язка лише по кліку, «Ні» — `Binding.nearNo`).
- `src/core/hikka-auth.ts` + `hikka-api.ts` (лише background) — OAuth Hikka і PUT /read; `src/features/hikka-sync.ts`, `hikka-bar.tsx` — синхронізація лічильника (`setHikkaChapters` — лише вгору; ручне зняття «прочитано» → `lowerHikkaChapters` до останнього розділу, прочитаного поспіль; скидання в «Дані» Hikka не чіпає).
- `entrypoints/hikka-bridge.ts` — скрипт у контексті сторінки (`injectScript`, web_accessible лише для hikka.io): після нашого PUT /read подія `hikka-plus:read-changed` (`src/core/bridge.ts`) → `invalidateQueries` у QueryClient самої Hikka (знаходимо через дерево React) для запитів з `read` в `_id` — віджет «у списку» оновлюється без F5. Зворотно: міст підписаний на кеш запитів Hikka — успішне оновлення `readGet`/`watchGet` (напр. «+/−» у віджеті Hikka) → подія `hikka-plus:hikka-list-changed` → `loadRemoteRead(..., quiet)` у `title-state.ts` → hikka-bar відмічає 1–N. DOM Hikka не змінюємо.
- Вікно налаштувань: `entrypoints/popup` (по іконці) і `entrypoints/options` (вкладка) → `src/settings/` (`app.tsx` — розділи Джерела / Hikka / Читалка / Дані, `data.ts` — копія JSON і скидання без токена Hikka, `mount.tsx` — той самий `style.css` у Shadow DOM + тема й кольори Hikka користувача з `src/core/site-theme.ts`, до першого заходу на hikka.io — системна тема). Поля читалки — спільні `NovelFields`/`MangaFields` з `reader/settings-panel.tsx`.
- `src/core/source-prefs.ts` — увімкнені джерела й порядок (`local:hp:sources` + `sync:hp:sources`); `sourcesFor`/`linkSourcesFor` їх враховують, content script перезавантажує блок тайтлу при зміні. `src/core/sync-flag.ts` — вимикач синхронізації між пристроями (`local:hp:syncOn`), перевіряється в усіх pull/push.
- `src/core/progress-sync.ts` — прогрес між пристроями через storage.sync (стисло, новіший перемагає).
- `src/core/prefs-sync.ts` — вибір користувача між пристроями: прив'язки (`sync:hp:b:*` — активне джерело, ручні прив'язки, команди; автопідбір НЕ синхронізується, до 80 тайтлів) і налаштування читалки (`sync:hp:settings`). Поле `Binding.u` — час останнього вибору.
- Збірка з клієнтом Hikka: `WXT_HIKKA_CLIENT_REFERENCE`/`WXT_HIKKA_CLIENT_SECRET` (`.env.local`, у CI — секрети репо `HIKKA_CLIENT_*`).
- `src/core/store.ts` — налаштування, прив'язки (`hp:bind2:*`, по кожному джерелу + команди), прогрес
  (`hp:progress2:*`, ключ — номер розділу, щоб не губився при зміні джерела/команди).
- `src/features/reader-url.ts` — відкритий розділ у `#read=джерело:id` (Hikka — SPA на TanStack Router, pushState безпечний).
- Плеєр аніме — `src/watch/` (блок «Перегляд» на /anime/<slug> після `#content-description`; «Ширше» — `wide-layout.ts`: плеєр у host `hikka-plus-theater` (position:absolute, ширина сітки) на своєму місці під верхніми картками бічних колонок; у колонки вставляємо лише свої відступи `hikka-plus-gap`, у блоці — slot потрібної висоти; кнопка «На весь екран» — `requestFullscreen` рамки, iframe не перезавантажується): `providers.ts` (Mikai + AnimeON за id з посилань «Перегляд» Hikka, злиття команд), `adapters.ts` (позиція Ashdi/Moon/Fenix через їхній postMessage — m3u8 не витягуємо; iframe лише з `FRAME_HOSTS`; єдиний наш скрипт у фреймах — `entrypoints/player-frame.content.ts`: лише в нашому iframe (`name="hikka-plus"`) прибирає стиль Hikka Features, що ховає рідну панель Ashdi/Moon; сам плеєр не чіпає), `threshold.ts` (серія зараховується з початку ED: мітка плеєра → AniSkip з перевіркою → за 90 с до кінця), `hikka-watch.ts` (PUT /watch лише вгору; дозволи watchlist — окремий вхід `startHikkaLogin(true)`, помилка прав → `error:'scope'`, токен не скидаємо), `watch-store.ts`, `watch-root.tsx`, `watch-block.tsx`. Tortuga — прибрано; Dawn — лише посилання на Mikai.
- CI (`.github/workflows/build.yml`): на тегу — реліз; якщо є секрети `AMO_API_KEY`/`AMO_API_SECRET` — `web-ext sign --channel unlisted` + `.xpi` у реліз. Архів вихідників без `.env*` і `CLAUDE.md` (`zip.excludeSources`).
- Картинки з manga.in.ua мають hotlink-захист — завжди `referrerPolicy="no-referrer"`.

## Перевірка перед комітом
```bash
npm run compile && npm run build && npm run build:firefox
```
Якоря DOM Hikka (`#content-left-side`, `#content-description`, `#content-center`) перевіряти вживу.
Тексти інтерфейсу — українською.
