import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const resolveExisting = (path: string) =>
  realpath(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });

/** Refuses a path whose directory, or itself when present, resolves through a symlink to outside the root; nothing existing means nothing to escape through. */
export async function assertRealPathInside(
  root: string,
  target: string,
): Promise<void> {
  const realRoot = await resolveExisting(root);
  if (realRoot === null) return;
  for (const path of [dirname(target), target]) {
    const real = await resolveExisting(path);
    if (real !== null && real !== realRoot && !real.startsWith(realRoot + sep))
      throw new Error(`Path escapes ${root} through a symlink: ${target}`);
  }
}

/**
 * Written to a temp file in the target's directory then renamed, so readers never see a partial file and the rename stays atomic;
 * the temp file is removed on failure. With `containedIn`, the directory must not resolve outside that root through a symlink.
 */
export async function writeFileAtomically(
  target: string,
  content: Buffer | Readable,
  containedIn?: string,
): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  if (containedIn !== undefined)
    await assertRealPathInside(containedIn, target);
  const temporary = join(dirname(target), `.tmp-${randomUUID()}`);
  try {
    if (Buffer.isBuffer(content)) await writeFile(temporary, content);
    else await pipeline(content, createWriteStream(temporary));
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
