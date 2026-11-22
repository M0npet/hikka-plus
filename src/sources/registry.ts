import type { ReadKind } from '../core/page';
import { animesvit } from './animesvit';
import { baka } from './baka';
import { dgManga } from './dgmanga';
import { honeyManga } from './honeymanga';
import { mangaInUa } from './mangainua';
import { runi } from './runi';
import { smakolyky } from './smakolyky';
import { uaManga } from './uamanga';
import type { ReadSource } from './types';
import { zenko } from './zenko';

/** Порядок = пріоритет, коли користувач ще нічого не обрав. Лише українські джерела. */
export const SOURCES: ReadSource[] = [zenko, mangaInUa, baka, honeyManga, uaManga, dgManga, animesvit, smakolyky, runi];

export const getSource = (id: string) => SOURCES.find((s) => s.id === id);
export const sourcesFor = (kind: ReadKind) => SOURCES.filter((s) => s.kinds.includes(kind));
