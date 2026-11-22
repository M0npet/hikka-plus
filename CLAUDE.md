# Hikka Plus — правила для Claude

Розширення для hikka.io (WXT 0.21 + React 19 + TypeScript, MV3 для Chrome, MV2 для Firefox).
Карта проєкту й рішення MK — у claude.ai-проєкті «Hikka The Project» (`claude/project-map.md`,
`claude/research-readers-and-layout.md`).

## Рішення MK (не порушувати)
- Усе вбудовано в сайт і в його стилі; блок розділів і кнопка — на сторінці тайтлу, читалка — оверлей.
- Джерела — **тільки українські** (Zenko, manga.in.ua, baka.in.ua). Senkuro — лише зразок UX.
- Без власного сервера. Віддалено можна оновлювати лише дані (JSON), не код (політики AMO/CWS).
- Не заважати Hikka Features і Hikka Forge: тільки свій Shadow DOM з тегами `hikka-plus-*`,
  класи `hp-*`, чужий DOM не змінювати, клавіші перехоплювати лише при відкритій читалці.
- «Свої тайтли в каталозі» — відкладено, не робити.
- Назва: Hikka Plus, неофіційне; не видавати себе за Hikka.

## Структура
- `entrypoints/background.ts` — fetch за allowlist (`src/core/hosts.ts`), CORS обходимо тут.
- `entrypoints/content/` — монтування блоків (`src/core/mount.ts`, self-healing для SPA), стилі `style.css`.
- `src/features/title-state.ts` — спільний стан тайтлу (кнопка, блок, читалка).
- `src/sources/` — джерела (`ReadSource`), автопідбір (`match.ts`).
- `src/core/store.ts` — налаштування, прив'язки (`hp:bind2:*`, по кожному джерелу + команди), прогрес
  (`hp:progress2:*`, ключ — номер розділу, щоб не губився при зміні джерела/команди).
- `src/features/reader-url.ts` — відкритий розділ у `#read=джерело:id` (Hikka — SPA на TanStack Router, pushState безпечний).
- Картинки з manga.in.ua мають hotlink-захист — завжди `referrerPolicy="no-referrer"`.

## Перевірка перед комітом
```bash
npm run compile && npm run build && npm run build:firefox
```
Якоря DOM Hikka (`#content-left-side`, `#content-description`, `#content-center`) перевіряти вживу.
Тексти інтерфейсу — українською.
