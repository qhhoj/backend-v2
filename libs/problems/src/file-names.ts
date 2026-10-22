import { basename, extname } from 'node:path';

const FILE_NAME_MAX_LENGTH = 100;

/** Client names never reach the filesystem as sent: allow-listed characters only, no `..`, no leading dot, capped. */
export const safeFileName = (name: string): string =>
  basename(name)
    .replace(/\s+/g, '_')
    .replace(/[^\w.-]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '')
    .slice(0, FILE_NAME_MAX_LENGTH) || 'material';

/** Lower-cased extension without the dot; `''` for a dotless name. */
export const extensionOf = (name: string): string =>
  extname(name).slice(1).toLowerCase();

/** A path with a part that starts with `.` (`.tests/1.in`, `__MACOSX/._1.in`): judge-v2 never opens it as a case file (`resolve.rs` `is_relative_name`). */
export const hasDotSegment = (path: string): boolean =>
  path.split('/').some((segment) => segment.startsWith('.'));
