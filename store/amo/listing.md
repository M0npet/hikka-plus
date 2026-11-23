# Сторінка Hikka Plus на addons.mozilla.org

Тексти для форми AMO (Developer Hub → Hikka Plus → «Edit Product Page»). Мова за замовчуванням
у дополнения — English (en-US, бо в маніфесті немає `default_locale`), тож англійський текст — основний,
український додається як переклад (перемикач мови вгорі форми → «Українська»).

| Поле | Значення |
|---|---|
| Name | Hikka Plus |
| Add-on URL (slug) | `hikka-plus` |
| Categories (Firefox) | Photos, Music & Videos; Other |
| Categories (Android) | Other |
| Tags | AMO дає вибрати лише з готового списку — взяти, що підходить (якщо нічого — пропустити) |
| Homepage | https://github.com/M0npet/hikka-plus |
| Support site | https://github.com/M0npet/hikka-plus/issues |
| Support email | — (не вказувати; контакт — GitHub Issues) |
| License | MIT |
| Privacy policy | вставити текст `PRIVACY.md` (обидві мови) — або лишити порожнім: з 04.08.2025 AMO не вимагає хостити політику в себе, посилання є в описі й у вікні налаштувань |
| This add-on requires payment… | ні |

---

## Українська (uk)

**Summary** (≤ 250 символів):

> Плеєр аніме та читалка манґи й ранобе прямо на сторінках hikka.io: українські озвучки й переклади, прогрес і синхронізація зі списком Hikka. Неофіційне розширення.

**Description:**

```
Hikka Plus додає на сторінки тайтлів hikka.io те, чого там бракує: перегляд і читання — без переходу на інші сайти. Усе вбудовано в саму сторінку й оформлено в стилі Hikka (тема, кольори й заокруглення беруться з вашої теми).

<b>Аніме — блок «Перегляд»</b>
• Плеєри українських озвучок прямо на сторінці аніме (дані — з Mikai та AnimeON, плеєри Ashdi, Moon, Fenix).
• Сітка серій із позначками переглянутого, перемикання команд озвучки, «Ширше» на всю ширину сторінки і «На весь екран».
• Опенінг і ендинг видно на смужці під плеєром, кнопка «Пропустити» (або пропуск сам); якщо плеєр не дає міток, Hikka Plus знаходить їх сам, порівнюючи кадри серій. Можна позначити й самому — «Тут опенінг» / «Тут ендинг» в одній серії, і далі мітки з'являться в усіх серіях тайтлу.
• Експериментально: «Сканувати серії наперед» — мітки одразу, без перегляду двох серій (вимкнено за замовчуванням: трафік і навантаження на процесор).
• На картках аніме в каталозі, календарі та «Моїх списках» — плашки «▶ N нових» (для «Дивлюсь») і «N серія через X дн.».
• «Вимкнути світло» — затемнити все навколо плеєра.
• Серія зараховується з початку ендингу; за бажанням лічильник у вашому списку Hikka оновлюється сам.
• Підсвітка навколо плеєра з кольорів кадру (як Ambilight) — вимикається, прозорість і яскравість регулюються.
• Експериментально: підсвітка телевізора Philips Ambilight, WLED, Philips Hue, Razer Chroma від відео (вимкнено за замовчуванням).

<b>Манґа, манхва, ранобе — блок «Розділи» і читалка</b>
• Розділи з українських сайтів: Zenko, manga.in.ua, Бака, Honey Manga, UAManga, DGManga, Animesvit, Смаколики, Runi, NovelHub, FanVers, Wattpad (лише українською).
• Перемикач джерел і команд перекладу, автопідбір тайтлу, ручна прив'язка.
• Читалка поверх сторінки: стрічка для манхви, посторінково (і справа наліво), налаштування шрифту й теми для ранобе; адреса розділу — в посиланні.
• Прогрес «прочитано N з M», «Продовжити» з місця, де зупинились.

<b>Синхронізація</b>
• Вхід через Hikka (OAuth): прочитані розділи й переглянуті серії оновлюють ваш список Hikka.
• Прогрес і налаштування — між вашими пристроями через синхронізацію браузера. Власного сервера в розширення немає.

<b>Важливо</b>
• Hikka Plus — неофіційне розширення, не пов'язане з командою Hikka.
• Вміст показується з сайтів-джерел так, як вони його віддають; захист сайтів не обходиться — такі сайти лише посиланням. Плеєри — це iframe їхніх власників (можуть показувати свою рекламу).
• Не заважає Hikka Features і Hikka Forge.

Політика приватності: https://github.com/M0npet/hikka-plus/blob/main/PRIVACY.md
Код: https://github.com/M0npet/hikka-plus
Помилки й пропозиції: https://github.com/M0npet/hikka-plus/issues
```

**Developer comments** (необов'язково):

```
Знайшли помилку або джерело, якого бракує? Напишіть у GitHub Issues — з назвою тайтлу та посиланням на Hikka.
```

---

## English (en-US) — default locale

**Summary:**

> Watch anime and read manga and light novels right on hikka.io title pages: Ukrainian dubs and translations, progress tracking and sync with your Hikka list. Unofficial extension.

**Description:**

```
Hikka Plus brings watching and reading into the title pages of hikka.io, the Ukrainian anime and manga tracker — no need to jump between sites. Everything is embedded into the page itself and follows your Hikka theme.

<b>Anime — "Watch" block</b>
• Ukrainian-dub players right on the anime page (episode data from Mikai and AnimeON; Ashdi, Moon and Fenix players).
• Episode grid with watched marks, dub team switching, "Wider" layout and full screen.
• Opening and ending shown on a bar under the player, "Skip" button (or auto-skip); when the player has no marks, Hikka Plus finds them itself by comparing frames of episodes. You can also mark them yourself — "Opening here" / "Ending here" in one episode, and the marks then appear in every episode of the title.
• Experimental: "Scan episodes ahead" — marks right away, without watching two episodes (off by default: uses traffic and CPU).
• Badges on anime cards in the catalogue, calendar and "My lists": "▶ N new" (for "Watching") and "Episode N in X days".
• "Lights off" — dim everything around the player.
• An episode counts as watched from the start of the ending; optionally your Hikka list is updated automatically.
• Ambient glow around the player from the video frame — can be turned off, opacity and brightness adjustable.
• Experimental: Philips Ambilight TV, WLED, Philips Hue and Razer Chroma lighting from the video (off by default).

<b>Manga, manhwa, light novels — "Chapters" block and reader</b>
• Chapters from Ukrainian sites: Zenko, manga.in.ua, Baka, Honey Manga, UAManga, DGManga, Animesvit, Smakolyky, Runi, NovelHub, FanVers, Wattpad (Ukrainian only).
• Source and translation team switcher, automatic title matching, manual linking.
• Overlay reader: vertical strip for manhwa, paged mode (incl. right-to-left), font and theme settings for novels; the chapter is kept in the page URL.
• "Read N of M" progress, "Continue" from where you stopped.

<b>Sync</b>
• Sign in with Hikka (OAuth): read chapters and watched episodes update your Hikka list.
• Progress and settings sync across your devices via browser sync. The extension has no server of its own.

<b>Please note</b>
• Hikka Plus is unofficial and not affiliated with the Hikka team.
• Content is shown from the source sites as they serve it; site protections are not bypassed — such sites are offered as links only. Players are their owners' iframes and may show their own ads.
• Works alongside Hikka Features and Hikka Forge.

The interface is in Ukrainian.

Privacy policy: https://github.com/M0npet/hikka-plus/blob/main/PRIVACY.md
Source code: https://github.com/M0npet/hikka-plus
Bugs and suggestions: https://github.com/M0npet/hikka-plus/issues
```

---

## Скріншоти

1280×800 (PNG). Підпис — у полі під кожним скріншотом (англійською, можна й українською в перекладі).

| # | Що на кадрі | Підпис (en) |
|---|---|---|
| 1 | Сторінка аніме, блок «Перегляд» у звичайному режимі, грає серія, сітка серій із переглянутими | Ukrainian-dub player right on the anime page |
| 2 | Той самий тайтл у «Ширше», видно підсвітку навколо плеєра | "Wider" layout with ambient glow |
| 3 | Сторінка манґи: блок «Розділи» (перемикач джерел, прогрес, кружечки стану) | Chapters from Ukrainian sources with progress |
| 4 | Відкрита читалка манхви (стрічка) | Overlay reader — vertical strip for manhwa |
| 5 | Читалка ранобе з відкритими налаштуваннями тексту | Light-novel reader with text settings |
| 6 | Вікно налаштувань, вкладка «Плеєр» | Settings — player, opening/ending marks, card badges |
| 7 | Вікно налаштувань, вкладка «Джерела» | Settings — choose and order sources |

Кадри 6–7 знято зі справжньої збірки (Chrome, темна тема; Claude надіслав у чат 2026-11-23; кадр 6 перезнято для 0.6.0). Кадри 1–5 — у Firefox на живому hikka.io:
тайтли без 18+, інші розширення на сторінці вимкнені (Hikka Features теж — щоб на кадрі було лише наше),
розмір сторінки 1280×800 — у Firefox `Ctrl+Shift+M` (адаптивний дизайн) → розмір 1280×800 → значок камери
«Зробити знімок» (зберігає PNG саме сторінки, без панелей браузера).
