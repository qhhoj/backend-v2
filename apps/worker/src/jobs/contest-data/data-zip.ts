import type { ZipLimits } from '../lazy-zip';

export type ContestDataLimits = ZipLimits;
export const CONTEST_DATA_LIMITS = Symbol('CONTEST_DATA_LIMITS');
export const DEFAULT_CONTEST_DATA_LIMITS: ContestDataLimits = {
  maxBytes: 512 * 1024 * 1024,
  maxEntries: 50_000,
  sourceChunk: 100,
};
/** A failed job is dropped, so the status returns to `none`; the message reaches only the worker log and never holds a source. */
export class ContestDataError extends Error {}

export interface DataRow {
  submissionId: string;
  userId: string;
  username: string;
  code: string;
  extension: string;
}
export interface DataEntry {
  submissionId: string;
  name: string;
}

const SEGMENT_LENGTH = 64;
/** One path segment: letters, digits, `_ . -` (Unicode letters kept), never empty, `.` or `..`. */
export function safeSegment(name: string): string {
  const cleaned = name
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}_.-]/gu, '_')
    .slice(0, SEGMENT_LENGTH);
  return /^\.*$/.test(cleaned)
    ? '_'.repeat(Math.max(1, cleaned.length))
    : cleaned;
}

/** Legacy layout; rows best first. Problem codes are already `[a-z0-9_]`. */
export function planEntries(rows: readonly DataRow[]): DataEntry[] {
  const folders = new Map<string, string>();
  const taken = new Set<string>();
  const folderOf = (userId: string, username: string) => {
    const known = folders.get(userId);
    if (known) return known;
    const base = safeSegment(username);
    let folder = base;
    for (let suffix = 2; taken.has(folder); suffix += 1)
      folder = `${base}_${suffix}`;
    taken.add(folder);
    folders.set(userId, folder);
    return folder;
  };
  const exported = new Set<string>();
  return rows.map(({ submissionId, userId, username, code, extension }) => {
    const folder = folderOf(userId, username);
    const suffix = extension.replace(/[^A-Za-z0-9]/g, '') || 'txt';
    const first = !exported.has(`${userId}/${code}`);
    exported.add(`${userId}/${code}`);
    return {
      submissionId,
      name: first
        ? `${folder}/${code}.${suffix}`
        : `${folder}/$History/${code}_${submissionId}.${suffix}`,
    };
  });
}
