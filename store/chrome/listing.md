# Hikka Plus у Chrome Web Store

Тексти для форми Developer Dashboard (chrome.google.com/webstore/devconsole). Перевірено за документацією
Chrome 2026-11-24. Пакет — `hikka-plus-<версія>-chrome.zip` із релізу (магазин підписує сам).

## Пакет
- Іконка 128×128 обов'язкова **в самому zip** — тепер це `public/icon/{16,32,48,128}.png` (WXT сам додає `icons`
  у маніфест). Без неї завантаження не пройде, тож іконки мають бути в коміті **до тегу**.
- Короткий опис (summary) магазин бере з `description` маніфесту (≤ 132 символи):
  «Плеєр аніме та читалка манґи й ранобе прямо на сторінках тайтлів hikka.io. Неофіційне розширення.»

## Вкладка Store listing

| Поле | Значення |
|---|---|
| Мова | Українська (у маніфесті немає `_locales`, тож мова одна; інтерфейс — український) |
| Категорія | Lifestyle → **Entertainment** |
| Store icon 128×128 | `public/icon/128.png` (знак «X, що переходить у +»; малюнок 96×96 + прозорі поля 16 px, як радить Google) |
| Small promo tile 440×280 | `store/chrome/promo-440x280.png` |
| Marquee 1400×560 | не потрібен |
| Screenshots 1280×800 (1–5) | кадри 1, 2, 3, 4, 6 зі `store/amo/listing.md` (ті самі файли) |
| Official URL | — (немає свого сайту в Search Console) |
| Homepage URL | https://github.com/M0npet/hikka-plus |
| Support URL | https://github.com/M0npet/hikka-plus/issues |
| Mature content | Ні (18+ джерел у збірці немає) |

### Detailed description (uk) — простий текст, HTML магазин не розуміє

```
Hikka Plus додає на сторінки тайтлів hikka.io перегляд і читання — без переходу на інші сайти. Усе вбудовано в саму сторінку й оформлено в стилі Hikka (тема, кольори й заокруглення беруться з вашої теми).

АНІМЕ — БЛОК «ПЕРЕГЛЯД»
• Плеєри українських озвучок прямо на сторінці аніме (дані — з Mikai та AnimeON, плеєри Ashdi, Moon, Fenix).
• Сітка серій із позначками переглянутого, перемикання команд озвучки.
• «Ширше» на всю ширину сторінки, «Розмір плеєра» — на всю ширину вікна або на всю висоту екрана, «На весь екран».
• Опенінг і ендинг на смужці під плеєром (мітки самого плеєра, інакше приблизні з AniSkip), кнопка «Пропустити» або пропуск сам.
• Плашки на картках аніме в каталозі, календарі та «Моїх списках»: «▶ N нових» і «N серія через X дн.».
• «Вимкнути світло» та підсвітка навколо плеєра з кольорів кадру (вимикається, прозорість і яскравість регулюються).
• Серія зараховується з початку ендингу; за бажанням лічильник у вашому списку Hikka оновлюється сам.
• Експериментально: підсвітка Philips Ambilight TV, WLED, Philips Hue, Razer Chroma від відео (вимкнено за замовчуванням).

МАНҐА, МАНХВА, РАНОБЕ — БЛОК «РОЗДІЛИ» І ЧИТАЛКА
• Розділи з українських сайтів: Zenko, manga.in.ua, Бака, Honey Manga, UAManga, DGManga, Animesvit, Смаколики, Runi, NovelHub, FanVers, Wattpad (лише українською).
• Перемикач джерел і команд перекладу, автопідбір тайтлу, ручна прив'язка.
• Читалка поверх сторінки: стрічка для манхви, посторінково (і справа наліво), шрифт і тема для ранобе; адреса розділу — в посиланні.
• Прогрес «прочитано N з M», «Продовжити» з місця, де зупинились.

СИНХРОНІЗАЦІЯ
• Вхід через Hikka (OAuth): прочитані розділи й переглянуті серії оновлюють ваш список Hikka.
• Прогрес і налаштування — між вашими пристроями через синхронізацію браузера. Власного сервера в розширення немає, розробнику нічого не надсилається.

ВАЖЛИВО
• Hikka Plus — неофіційне розширення, не пов'язане з командою Hikka.
• Вміст показується з сайтів-джерел так, як вони його віддають; захист сайтів не обходиться — такі сайти лише посиланням. Плеєри — iframe їхніх власників (можуть показувати свою рекламу).
• Не заважає Hikka Features і Hikka Forge.

Політика приватності: https://github.com/M0npet/hikka-plus/blob/main/PRIVACY.md
Код: https://github.com/M0npet/hikka-plus
Помилки й пропозиції: https://github.com/M0npet/hikka-plus/issues
```

(Якщо мовою лістингу оберете English — опис англійською такий самий, як у `store/amo/listing.md`, лише
без тегів `<b>` і з рядком про «Player size: full window width or full screen height».)

## Вкладка Privacy practices

**Single purpose description:**
```
Hikka Plus adds anime watching and manga/light-novel reading to the title pages of hikka.io (a Ukrainian anime and manga tracker): it embeds Ukrainian-dub players and a chapter list with an overlay reader into the page, and keeps the user's watch/read progress in sync with their Hikka list.
```

**Permission justification** (по полю на кожен дозвіл):

- `storage`
```
Stores the user's settings, reading/watching progress, title-to-source links and the Hikka sign-in token locally (storage.local), and syncs progress and settings across the user's devices (storage.sync). Nothing is sent to the developer.
```
- Host permissions (`https://hikka.io/*`, `https://api.hikka.io/*` та API джерел; content script у плеєрах Ashdi/Moon/Fenix)
```
hikka.io: the content script embeds the player, chapter list and reader into hikka.io title pages. api.hikka.io: reads the opened title's public data and, only after the user signs in with Hikka, updates their read/watch counter. Ukrainian manga/novel sites (api.zenko.online, manga.in.ua, baka.in.ua, honey-manga, uamanga.com, back.animesvit.com, dgmanga.app, runi.ink, api.smakolykytl.site, novel.org.ua, fan-vers.com, wattpad.com, and for link search only mangra.app, faust-web.com, mangarama.com.ua, manga.valsky.org): search the opened title and load the chapter list and the chapter the user opens. api.mikai.me, animeon.club: list of Ukrainian dubs and episodes. api.aniskip.com: opening/ending times. A small content script runs inside the Ashdi, Moon and Fenix player iframes (only when embedded by the extension) to read the player's opening/ending marks and progress and a 32×18 px frame for the ambient glow; nothing leaves the device. Requests go only to this fixed list of hosts and without the sites' cookies.
```
- Optional host permissions `http://*/*`, `https://*/*`
```
Optional, never requested at install. Used only by the experimental "device lighting" feature (off by default): when the user adds a Philips Ambilight TV, WLED controller, Philips Hue bridge or Razer Chroma on their local network, the extension asks for permission for that one address and sends it the colours of the video edges. The device address is not known in advance, so a specific host cannot be listed in the manifest.
```

**Are you using remote code?** — **No, I am not using remote code.**
(Плеєри Ashdi/Moon/Fenix — звичайні iframe сторінок їхніх власників; розширення не завантажує й не виконує їхній JS у своєму коді.)

**Data usage — що позначити** (як у `PRIVACY.md` і в декларації Firefox):

| Категорія | Позначити | Чому |
|---|---|---|
| Personally identifiable information | ні | ім'я, пошту, нік не читаємо й не передаємо |
| Health / Financial / Personal communications / Location | ні | — |
| **Authentication information** | **так** | токен доступу Hikka (OAuth), зберігається локально, йде лише на api.hikka.io |
| **Web history** | **так** | назва/ID тайтлу, який відкрито на hikka.io, іде джерелам, Mikai, AnimeON, AniSkip — це дані про відкриті сторінки |
| User activity | ні | кліки, клавіші, прокрутку не записуємо й не передаємо |
| **Website content** | **так** | читаємо дані сторінки Hikka й кадр відео (для підсвітки; кольори країв ідуть лише на пристрої підсвітки, які користувач додав сам) |

Три сертифікати внизу — **поставити всі** (не продаємо дані; не використовуємо їх поза єдиною метою;
не для кредитоспроможності) — усе це правда.

**Privacy policy URL:** `https://github.com/M0npet/hikka-plus/blob/main/PRIVACY.md`

## Вкладка Distribution
- Visibility: Public (або спершу Unlisted — сторінка лише за посиланням).
- Regions: усі.

## Вкладка Test instructions (необов'язково, але допомагає рецензенту)
```
No account is needed. Open https://hikka.io, pick any anime page with Ukrainian dubs (e.g. a currently airing title) — the "Перегляд" (Watch) block with the player appears between the description and the characters. Open any manga or light-novel page — the "Розділи" (Chapters) block and the "Читати" (Read) button appear. Settings: click the extension icon. Hikka sign-in (OAuth) is optional and only needed for list sync.
```
