import type { ReadKind } from '../core/page';
import type { ReadSource } from './types';
import { zenko } from './zenko';

/** Порядок = пріоритет під час автопідбору. Лише українські джерела. */
export const SOURCES: ReadSource[] = [zenko];

export const getSource = (id: string) => SOURCES.find((s) => s.id === id);
export const sourcesFor = (kind: ReadKind) => SOURCES.filter((s) => s.kinds.includes(kind));
