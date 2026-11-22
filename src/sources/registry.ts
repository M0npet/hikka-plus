import type { ReadKind } from '../core/page';
import { baka } from './baka';
import { mangaInUa } from './mangainua';
import type { ReadSource } from './types';
import { zenko } from './zenko';

/** Порядок = пріоритет, коли користувач ще нічого не обрав. Лише українські джерела. */
export const SOURCES: ReadSource[] = [zenko, mangaInUa, baka];

export const getSource = (id: string) => SOURCES.find((s) => s.id === id);
export const sourcesFor = (kind: ReadKind) => SOURCES.filter((s) => s.kinds.includes(kind));
