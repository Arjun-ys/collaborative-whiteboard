import type { SerializedCanvasObject } from '../types/whiteboard';
import { swapThemeColor } from './themeColors';

export const cloneSnapshot = (value: SerializedCanvasObject): SerializedCanvasObject =>
  JSON.parse(JSON.stringify(value)) as SerializedCanvasObject;

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
};

export const snapshotsMatch = (left?: SerializedCanvasObject, right?: SerializedCanvasObject) =>
  stableStringify(left ?? null) === stableStringify(right ?? null);

// Dark-theme ink is the storage convention; themes only affect the local view.
// Legacy snapshots using light-theme ink are also understood.
export const snapshotForTheme = (snapshot: SerializedCanvasObject, theme: 'light' | 'dark') => {
  const value = cloneSnapshot(snapshot);
  const fields = value.type === 'i-text' ? ['fill'] :
    ['path', 'rect', 'circle'].includes(value.type) ? ['stroke', 'fill'] : [];
  for (const field of fields) {
    if (typeof value[field] === 'string') value[field] = swapThemeColor(value[field], theme) ?? value[field];
  }
  return value;
};

export const canonicalSnapshot = (snapshot: SerializedCanvasObject) => snapshotForTheme(snapshot, 'dark');
