import type { ZipLimits } from '../lazy-zip';

export type ContestExportLimits = ZipLimits;
export const CONTEST_EXPORT_LIMITS = Symbol('CONTEST_EXPORT_LIMITS');
export const DEFAULT_CONTEST_EXPORT_LIMITS: ContestExportLimits = {
  maxBytes: 512 * 1024 * 1024,
  maxEntries: 50_000,
  sourceChunk: 100,
};
/** A failed job is dropped, so the status returns to `none`; the message reaches only the worker log and never holds a source. */
export class ContestExportError extends Error {}
