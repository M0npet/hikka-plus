import type { ReadKind } from '../core/page';
import { applySourcePrefs } from '../core/source-prefs';
import { animesvit } from './animesvit';
import { baka } from './baka';
import { dgManga } from './dgmanga';
import { fanVers } from './fanvers';
import { honeyManga } from './honeymanga';
import { mangaInUa } from './mangainua';
import { novelHub } from './novelhub';
import { runi } from './runi';
import { smakolyky } from './smakolyky';
import { uaManga } from './uamanga';
import type { ReadSource } from './types';
import { wattpad } from './wattpad';
import { zenko } from './zenko';

/** Порядок = пріоритет, коли користувач ще нічого не обрав. Лише українські джерела (Wattpad — тільки історії українською). */
export const SOURCES: ReadSource[] = [zenko, mangaInUa, baka, honeyManga, uaManga, dgManga, animesvit, smakolyky, runi, novelHub, fanVers, wattpad];

export const getSource = (id: string) => SOURCES.find((s) => s.id === id);
/** Увімкнені джерела для типу в порядку користувача (вікно налаштувань розширення). */
export const sourcesFor = (kind: ReadKind) => applySourcePrefs(SOURCES.filter((s) => s.kinds.includes(kind)));
