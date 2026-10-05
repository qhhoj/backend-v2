import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Written to a temp name next to the target then renamed, so readers never see a partial file; the temp file is removed on failure. */
export async function writeFileAtomically(
  target: string,
  content: Buffer | Readable,
): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    if (Buffer.isBuffer(content)) await writeFile(temporary, content);
    else await pipeline(content, createWriteStream(temporary));
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
