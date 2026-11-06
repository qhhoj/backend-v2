import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Whether `path` is `root` or below it, comparing the two as written. */
export function isInside(root: string, path: string): boolean {
  const relation = relative(root, path);
  // `..cache` is a child; only a leading `..` segment leaves the root.
  return relation.split(sep)[0] !== '..' && !isAbsolute(relation);
}

/** Symlinks followed, as nginx does; a path not created yet resolves through its nearest existing ancestor. A bind mount overlapping at the host level is not detected. */
function realPathOf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(resolve(path));
    return parent === resolve(path)
      ? parent
      : join(realPathOf(parent), resolve(path).slice(parent.length + 1));
  }
}

/** `isInside` after both paths are resolved through symlinks. */
export const isInsideReal = (root: string, path: string): boolean =>
  isInside(realPathOf(root), realPathOf(path));

/** `relativePath` under `root`, strictly below it; `label` names the root in the refusal. */
export function resolveInside(
  root: string,
  relativePath: string,
  label: string,
): string {
  const target = resolve(root, relativePath);
  if (target === root || !isInside(root, target))
    throw new Error(`Path escapes ${label}: ${relativePath}`);
  return target;
}
