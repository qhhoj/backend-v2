import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { isInside } from './paths';

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
    if (real !== null && !isInside(realRoot, real))
      throw new Error(`Path escapes ${root} through a symlink: ${target}`);
  }
}

const TEMP_NAME =
  /^\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;

/** Whether `name` is a file `atomicWrite` leaves behind only when the process died mid-write; sweepers remove these and no other `.tmp` file. */
export const isTempName = (name: string): boolean => TEMP_NAME.test(name);

/** A short name beside the target, so a target whose name is near the filesystem limit still gets a temp file. */
const tempPathBeside = (target: string): string =>
  join(dirname(target), `.${randomUUID()}.tmp`);

/**
 * Written to a temp file in the target's directory then renamed, so readers never see a partial file and the rename stays atomic;
 * the temp file is removed on failure. `data` is bytes, a stream, or a function that writes the file at the path it is given.
 * With `containedIn`, the directory must not resolve outside that root through a symlink.
 */
export async function atomicWrite(
  target: string,
  data: Buffer | Readable | ((temporaryPath: string) => Promise<void>),
  containedIn?: string,
): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  if (containedIn !== undefined)
    await assertRealPathInside(containedIn, target);
  const temporary = tempPathBeside(target);
  try {
    if (typeof data === 'function') await data(temporary);
    else if (Buffer.isBuffer(data)) await writeFile(temporary, data);
    else await pipeline(data, createWriteStream(temporary));
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
