# Політика приватності Hikka Plus

*Чинна з 2026-11-23. English version below.*

Hikka Plus — неофіційне розширення для [hikka.io](https://hikka.io): читалка манґи й ранобе та плеєр аніме прямо на сторінці тайтлу. Розробник — M0npet.

## Коротко

- **У розробника немає сервера.** Розширення нічого не надсилає розробнику: ні аналітики, ні статистики, ні звітів про помилки, ні реклами.
- Усе, що розширення пам'ятає (прогрес, вибір джерел, налаштування, вхід у Hikka), зберігається **у вашому браузері**.
- Дані виходять із браузера лише туди, звідки розширення бере вміст для показу, або туди, куди ви самі попросили їх надіслати. Нижче — точний список.

## Що надсилається і куди

### 1. Hikka (api.hikka.io)
- **Завжди:** адреса (slug) тайтлу, який ви відкрили на hikka.io, — щоб отримати його назви й посилання на сайти з читанням чи переглядом. Ці дані публічні.
- **Назви серій** у плеєрі: для відкритого аніме — публічний список серій Hikka (`/anime/<slug>/episodes`, без входу й без ваших даних), зберігається локально на 3 дні.
- **Наступний сезон:** на останній серії аніме (і у віконці картки, коли тайтл переглянуто повністю) — публічні зв'язки франшизи Hikka (`/related/anime/<slug>/franchise`, без входу й без ваших даних), зберігаються локально на 3 дні.
- **«Далі з Дивлюсь»** (вимикається в налаштуваннях плеєра): на останній серії аніме без наступного сезону — ваш публічний список «Дивлюсь» на Hikka (`/watch/<ім'я>/list`, без входу). Ім'я користувача Hikka розширення бере з даних, які сторінка Hikka вже завантажила сама, зберігає локально й надсилає лише на api.hikka.io; список тримає в пам'яті 10 хвилин.
- **Мова назв** (українська / англійська / оригінальна) — та, що обрана у вашому профілі Hikka: розширення бере її з даних, які сторінка Hikka вже завантажила сама (окремого запиту немає), і зберігає локально.
- **Плашки на картках аніме** («N серія через X дн.»): раз на 3 години — публічний розклад серій Hikka (`/schedule/anime`, без входу й без ваших даних). «▶ N нових» рахується з того, що сторінка Hikka вже завантажила сама, — окремих запитів немає. Вимикається у вкладці «Плеєр» («Плашки на картках»).
- **Лише якщо ви увійшли через «Увійти в Hikka»:** розширення отримує від Hikka токен доступу з дозволами лише на ваш список читання (`read:readlist`, `update:readlist`), а якщо ви окремо натиснули «Відмічати в Hikka» у плеєрі — ще й на список перегляду (`read:watchlist`, `update:watchlist`). Токен зберігається лише локально і надсилається тільки на api.hikka.io. З ним розширення читає ваш запис про тайтл і оновлює кількість прочитаних розділів чи переглянутих серій — лише для тайтлу, який ви читаєте чи дивитесь, і лише коли ввімкнено «Оновлювати лічильник у Hikka» / «Відмічати серії в Hikka». Автоматично лічильник лише збільшується; зменшується тільки тоді, коли ви самі знімаєте позначку «прочитано» чи натискаєте «Скасувати».
- Пароль від Hikka розширення не бачить: вхід відбувається на сайті Hikka.
- **У Firefox** передача токена й прочитаного/переглянутого в Hikka — окрема необов'язкова згода (з версії 0.6.1): Firefox питає її, коли ви натискаєте «Увійти». Без згоди вхід не відбувається і в ваш список Hikka нічого не надсилається. Відкликати — `about:addons` → Hikka Plus → «Дозволи»; тоді розширення одразу забуває токен.

### 2. Українські сайти з манґою та ранобе
Zenko, manga.in.ua, baka.in.ua, Honey Manga, UAManga, DGManga, Animesvit, Смаколики, Runi, NovelHub, FanVers, Wattpad, а також лише для пошуку посилання на тайтл — FAUST, Mangarama, MANGAEZ (manga.valsky.org) і Mangra.
- Щоб знайти тайтл, розширення надсилає цим сайтам **назви тайтлу** (як на Hikka) або текст, який ви самі ввели в пошук. Потім воно завантажує список розділів і сторінки чи текст розділу, який ви відкрили. Mangra отримує лише запит загального каталогу (без назви тайтлу). Dengeki — лише посилання, запитів до нього розширення не робить.
- **Плашки «▶ N нових розділів»** (вкладка «Читалка», можна вимкнути): для тайтлів зі статусом «Читаю», які ви бачите на сторінці Hikka і які прив'язані до джерела, розширення не частіше ніж раз на 3 години завантажує список розділів з того самого джерела (той самий запит, що й при відкритті тайтлу). Прочитане береться з того, що сторінка Hikka вже завантажила, — окремих запитів до Hikka немає.
- **Українські постери** (вкладка «Hikka», можна вимкнути): для тайтлу манґи (Zenko, Honey Manga, DGManga, Manga.in.ua) чи ранобе (Бака, Honey Manga, DGManga), який ви вже відкривали й який прив'язаний до джерела, розширення бере обкладинку з цього джерела (один запит при відкритті тайтлу, далі не частіше ніж раз на 14 днів) і показує її замість постера Hikka. Сама картинка вантажиться з сайту джерела (без адреси сторінки Hikka в заголовку Referer) — так сайт джерела бачить вашу IP-адресу, як і в читалці.
- **Українські постери аніме** (той самий вимикач): для карток аніме, які ви бачите на сторінці Hikka, розширення надсилає Mikai їхні slug (ідентифікатори Hikka) одним запитом — до 100 за раз, не частіше ніж раз на 2 секунди, і про кожен тайтл не частіше ніж раз на 3–14 днів — і показує україномовний постер, якщо він є в Mikai. Картинка вантажиться з images.mikai.me.
- Запити йдуть **без ваших cookie** цих сайтів (`credentials: omit`); ваші облікові записи на цих сайтах не використовуються.
- Сайти, які ви вимкнули у вкладці «Джерела», не отримують жодних запитів.
- Як і під час звичайного відвідування, ці сайти бачать вашу IP-адресу та звичайні дані браузера. Їхні правила — у їхніх власних політиках.

### 3. Плеєр аніме
- **Mikai (api.mikai.me) та AnimeON (animeon.club):** ідентифікатор тайтлу на цих сайтах (з посилань «Перегляд» на Hikka), щоб отримати список озвучок і серій.
- **Типи серій** (філер / змішаний / канон аніме, вкладка «Плеєр», можна вимкнути): для відкритого аніме від 24 серій — сторінки AnimeFillerList (animefillerlist.com: список шоу раз на 2 тижні й сторінка знайденого шоу); якщо там тайтлу немає — slug Hikka до публічного API Mikai. Ваших даних не надсилається; зберігається локально на 7 днів (онгоінг — на 1 день).
- **Нові серії в озвучках** (вкладка «Плеєр», можна вимкнути): для тайтлів, які ви дивились у плеєрі розширення (до 40), фон раз на 3 години надсилає Mikai їхні slug (ідентифікатори Hikka) — той самий запит, що й плеєр, — і порівнює, скільки серій у вашої команди озвучення. Що ви дивитесь і яку команду обрали, зберігається лише на вашому пристрої. Сповіщення браузера — лише якщо ви їх увімкнете (браузер спитає дозвіл).
- **Нові розділи** (вкладка «Читалка», можна вимкнути): для тайтлів, які ви читали в читалці розширення (до 40), фон раз на 3 години завантажує з обраного джерела (Zenko, Manga.in.ua, UAManga, Honey Manga, Бака, DGManga) список розділів — той самий запит, що й при відкритті тайтлу, без cookie, — і порівнює найбільший номер розділу вашої команди перекладу. Тим самим результатом оновлюються й плашки «▶ N нових розділів». Що ви читаєте, зберігається лише на вашому пристрої. Сповіщення браузера — лише якщо ви їх увімкнете (браузер спитає дозвіл).
- **Ashdi, Moon (moonanime), Fenix:** плеєр вбудовано як iframe — так само, як на сайтах-джерелах. Плеєр завантажується з їхнього сервера, бачить вашу IP-адресу, може показувати свою рекламу й використовувати свої cookie. Сторінкою плеєра керує не розширення.
- **AniSkip (api.aniskip.com):** MyAnimeList-ID тайтлу та номер серії, щоб дізнатися, де починається ендинг (з цього моменту серія вважається переглянутою). Жодних ваших ідентифікаторів не надсилається.
- **Підсвітка навколо плеєра:** розширення зчитує зменшений кадр відео (32×18 пікселів) лише у своєму плеєрі й лише на вашому пристрої. Кадр нікуди не надсилається.
- **Мітки опенінгу й ендингу:** беруться з самого плеєра (Moon, Fenix), інакше — з AniSkip (див. вище). Кадри для цього не читаються.

### 4. Підсвітка пристроїв (експериментально, за замовчуванням вимкнено)
Якщо ви ввімкнете «Підсвітка пристроїв» і підключите телевізор Philips, WLED, Philips Hue чи Razer Chroma, розширення надсилатиме **кольори країв кадру** (до 5 разів на секунду) **лише на ті пристрої, адреси яких ви самі вказали** — у вашій локальній мережі (Razer — на ваш комп'ютер). Для цього розширення просить дозвіл браузера на конкретну адресу, а у Firefox — ще й окрему згоду на передачу цих даних (її можна відкликати в `about:addons` → Hikka Plus → «Дозволи»). Логін і ключ, які видає пристрій під час підключення (PIN телевізора, ключ моста Hue), зберігаються лише локально.

### 5. Синхронізація між пристроями
Якщо ввімкнено «Синхронізація» в розділі «Між пристроями» (за замовчуванням), прогрес читання, переглянуті серії й місце в серії (останні 25 аніме), вибір джерел і команд та налаштування читалки зберігаються в `storage.sync` вашого браузера. Їх переносить і зберігає сервіс синхронізації вашого браузера (Firefox Account або обліковий запис Google) за його правилами; розробник Hikka Plus до них доступу не має. Токен Hikka **не** синхронізується.

## Що зберігається локально
Налаштування, прогрес читання й перегляду, прив'язки тайтлів до джерел, увімкнені джерела, тема й кольори Hikka (щоб вікно налаштувань виглядало так само), токен Hikka, налаштування пристроїв підсвітки.

## Керування даними
- Вкладка **«Дані»** у вікні налаштувань: зберегти копію своїх даних у файл, відновити з файлу, скинути прогрес, прив'язки або все.
- **«Вийти»** у вкладці «Hikka» видаляє токен. Доступ також можна відкликати в налаштуваннях облікового запису Hikka.
- Вимикачі: «Показувати читалку», «Показувати плеєр», окремі джерела, «Оновлювати лічильник у Hikka», «Відмічати серії в Hikka», «Синхронізація» між пристроями, «Підсвітка», «Підсвітка пристроїв», «Українські постери».
- Firefox показує категорії даних, які передає розширення, під час встановлення і в `about:addons` → Hikka Plus → «Дозволи».
- Видалення розширення видаляє всі його локальні дані.

## Діти
Розширення не призначене для збирання даних будь-кого, зокрема дітей, і не збирає їх.

## Зміни
Про зміни цієї політики буде зазначено в описі нової версії; дата вгорі оновиться.

## Контакти
Розробник: M0npet. Питання й звернення — [GitHub Issues](https://github.com/M0npet/hikka-plus/issues).

---

# Hikka Plus Privacy Policy

*Effective 2026-11-23.*

Hikka Plus is an unofficial extension for [hikka.io](https://hikka.io) that adds a manga/light-novel reader and an anime player directly to title pages. Developer: M0npet.

## Summary

- **The developer runs no server.** The extension sends nothing to the developer: no analytics, telemetry, crash reports or ads.
- Everything the extension remembers (progress, source choices, settings, Hikka sign-in) is stored **in your browser**.
- Data leaves the browser only to the services the extension loads content from, or where you explicitly ask it to send something. The full list is below.

## What is sent, and where

### 1. Hikka (api.hikka.io)
- **Always:** the identifier (slug) of the title page you opened on hikka.io, to fetch its public names and links.
- **Episode titles** in the player: for the opened anime, the public Hikka episode list (`/anime/<slug>/episodes`, no sign-in, none of your data), cached locally for 3 days.
- **Next season:** on the last episode of an anime (and in the card pop-up once a title is fully watched) — the public Hikka franchise relations (`/related/anime/<slug>/franchise`, no sign-in, none of your data), cached locally for 3 days.
- **"Next from Watching"** (can be turned off in the player settings): on the last episode of an anime with no next season — your public Hikka "Watching" list (`/watch/<username>/list`, no sign-in). The Hikka username is taken from data the Hikka page has already loaded itself, stored locally and sent only to api.hikka.io; the list is kept in memory for 10 minutes.
- **Title language** (Ukrainian / English / original) — the one chosen in your Hikka profile: taken from data the Hikka page has already loaded itself (no extra request) and stored locally.
- **Badges on anime cards** ("episode N in X days"): every 3 hours the public Hikka episode schedule (`/schedule/anime`, no sign-in, none of your data). "▶ N new" is computed from what the Hikka page has already loaded itself — no extra requests. Can be turned off in the Player tab ("Плашки на картках").
- **Only if you sign in with "Увійти в Hikka":** Hikka issues an access token limited to your reading list (`read:readlist`, `update:readlist`) and, only if you separately press "Відмічати в Hikka" in the player, your watch list (`read:watchlist`, `update:watchlist`). The token is stored locally and sent only to api.hikka.io. It is used to read your list entry for the current title and update the number of read chapters / watched episodes, only while "Оновлювати лічильник у Hikka" / "Відмічати серії в Hikka" is on. Automatic updates only increase the count; it decreases only when you manually unmark a chapter or press "Скасувати".
- The extension never sees your Hikka password; sign-in happens on hikka.io.
- **In Firefox**, sending the token and your read/watched progress to Hikka is a separate optional consent (since 0.6.1): Firefox asks for it when you press "Увійти". Without it you are not signed in and nothing is sent to your Hikka list. Revoke it in `about:addons` → Hikka Plus → Permissions; the extension then forgets the token immediately.

### 2. Ukrainian manga and light-novel sites
Zenko, manga.in.ua, baka.in.ua, Honey Manga, UAManga, DGManga, Animesvit, Smakolyky, Runi, NovelHub, FanVers, Wattpad; and, for title-link lookup only, FAUST, Mangarama, MANGAEZ (manga.valsky.org) and Mangra.
- To find the title, the extension sends these sites the **title's names** (as listed on Hikka) or the text you type into the search box, then loads the chapter list and the pages/text of the chapter you open. Mangra only receives a request for its general catalogue (no title name). Dengeki is a plain link; the extension makes no requests to it.
- **"▶ N new chapters" badges** ("Читалка" tab, can be turned off): for titles marked "Reading" that you see on a Hikka page and that are linked to a source, the extension reloads the chapter list from that same source at most once every 3 hours (the same request as when you open the title). What you have read comes from data the Hikka page already loaded — no extra requests to Hikka.
- **Ukrainian posters** ("Hikka" tab, can be turned off): for a manga (Zenko, Honey Manga, DGManga, Manga.in.ua) or novel (Baka, Honey Manga, DGManga) title you have opened before and that is linked to that source, the extension takes the cover from that source (one request when you open the title, then at most every 14 days) and shows it instead of the Hikka poster. The image itself loads from the source site (with no Referer of the Hikka page), so the source sees your IP address, as in the reader.
- **Ukrainian anime posters** (same toggle): for anime cards you see on a Hikka page, the extension sends Mikai their slugs (Hikka identifiers) in one request — up to 100 at a time, at most every 2 seconds, and for each title at most once every 3–14 days — and shows the Ukrainian poster if Mikai has one. The image loads from images.mikai.me.
- Requests are made **without your cookies** for these sites (`credentials: omit`); your accounts on them are not used.
- Sources you disable in the "Джерела" tab receive no requests.
- As with any visit, these sites see your IP address and standard browser information; their own privacy policies apply.

### 3. Anime player
- **Mikai (api.mikai.me) and AnimeON (animeon.club):** the title's ID on those sites (from Hikka's "watch" links), to get the list of dubs and episodes.
- **Episode types** (filler / mixed / anime canon, "Плеєр" tab, can be turned off): for the opened anime with 24+ episodes — AnimeFillerList pages (animefillerlist.com: the show list once every 2 weeks and the matched show's page); if the title isn't there — its Hikka slug to Mikai's public API. None of your data is sent; cached locally for 7 days (1 day for ongoing titles).
- **New episodes in dubs** ("Плеєр" tab, can be turned off): for titles you have watched in the extension's player (up to 40), the background script sends Mikai their slugs (Hikka identifiers) once every 3 hours — the same request the player makes — to see whether your dub team has more episodes. What you watch and which team you chose stays on your device. Browser notifications only if you turn them on (the browser asks for permission).
- **New chapters** ("Читалка" tab, can be turned off): for titles you have read in the extension's reader (up to 40), the background script reloads the chapter list from the chosen source (Zenko, Manga.in.ua, UAManga, Honey Manga, Baka, DGManga) once every 3 hours — the same request as when you open the title, without cookies — to see whether your translation team has a higher chapter number. The same result also updates the "▶ N new chapters" badges. What you read stays on your device. Browser notifications only if you turn them on (the browser asks for permission).
- **Ashdi, Moon (moonanime), Fenix:** the player is embedded as an iframe, as on the source sites. It is loaded from their servers, sees your IP address and may show its own ads and use its own cookies. The extension does not control the player page.
- **AniSkip (api.aniskip.com):** the title's MyAnimeList ID and episode number, to find where the ending starts (the point at which the episode counts as watched). No identifiers of yours are sent.
- **Glow around the player:** the extension reads a downscaled video frame (32×18 pixels) only in its own player and only on your device. The frame is never sent anywhere.
- **Opening and ending marks:** taken from the player itself (Moon, Fenix), otherwise from AniSkip (see above). No frames are read for this.

### 4. Device lighting (experimental, off by default)
If you enable "Підсвітка пристроїв" and connect a Philips TV, WLED, Philips Hue or Razer Chroma, the extension sends **the colors of the frame edges** (up to 5 times per second) **only to the devices whose addresses you entered** — on your local network (Razer: on your own computer). The browser asks your permission for each address; Firefox additionally asks for consent to transmit this data (revocable in `about:addons` → Hikka Plus → Permissions). Pairing credentials issued by the device (TV PIN pairing, Hue bridge key) are stored locally only.

### 5. Sync between devices
If "Синхронізація" under "Між пристроями" is on (default), reading progress, watched episodes and the position in the episode (last 25 anime), source/team choices and reader settings are stored in your browser's `storage.sync`. They are transferred and stored by your browser's sync service (Firefox Account or Google account) under its terms; the developer has no access. The Hikka token is **not** synced.

## Stored locally
Settings, reading and watching progress, title-to-source bindings, enabled sources, Hikka theme colors (so the settings window matches the site), the Hikka token, lighting device settings.

## Your controls
- **"Дані"** tab: export your data to a file, import it, reset progress, bindings or everything.
- **"Вийти"** in the "Hikka" tab deletes the token; you can also revoke access in your Hikka account settings.
- Toggles: show reader, show player, individual sources, Hikka counter sync, episode marking in Hikka, sync between devices, player glow, device lighting, Ukrainian posters.
- Firefox lists the data categories the extension transmits at install time and in `about:addons` → Hikka Plus → Permissions.
- Uninstalling the extension removes all its local data.

## Children
The extension is not designed to collect, and does not collect, data from anyone, including children.

## Changes
Changes to this policy will be noted in the release notes; the date above will be updated.

## Contact
Developer: M0npet. Questions and requests: [GitHub Issues](https://github.com/M0npet/hikka-plus/issues).

Chrome Web Store: the use of information received by this extension adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.
