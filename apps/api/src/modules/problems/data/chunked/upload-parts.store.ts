import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  assertRealPathInside,
  atomicWrite,
  ENV,
  resolveInside,
} from '@libs/common';
import type { Env } from '@libs/common';
import { UUID_PATTERN } from '@libs/database';

/** Beside `.imports`; dot-prefixed, so no problem code names it. */
const UPLOADS_DIRECTORY = '.uploads';

/** Part `index` is listed as received but its file is gone. */
export class MissingPartError extends Error {
  constructor(readonly index: number) {
    super(`Upload part ${index} is missing`);
  }
}

/** The sha256 (hex) of a file, streamed. */
export async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>)
    hash.update(chunk);
  return hash.digest('hex');
}

/** The bytes of chunked uploads: `<PROBLEM_DATA_ROOT>/.uploads/<session id>/<index>`, outside every problem directory (the judge contract). */
@Injectable()
export class UploadPartsStore {
  private readonly root: string;

  constructor(@Inject(ENV) env: Env) {
    this.root = resolve(env.problemDataRoot);
  }

  /** `write` fills a temp path that is then renamed to the part, so a dropped chunk never leaves half a part and a resend replaces it whole. */
  async write(
    sessionId: string,
    index: number,
    write: (temporaryPath: string) => Promise<void>,
  ): Promise<void> {
    await atomicWrite(this.partPath(sessionId, index), write, this.root);
  }

  /** Parts `0..count-1` concatenated into `target` (a new file); returns its length and sha256 (hex). A part file that is gone is `MissingPartError`. */
  async assemble(
    sessionId: string,
    count: number,
    target: string,
  ): Promise<{ bytes: number; sha256: string }> {
    await assertRealPathInside(this.root, this.directoryOf(sessionId));
    const paths = Array.from({ length: count }, (_item, index) =>
      this.partPath(sessionId, index),
    );
    const hash = createHash('sha256');
    let bytes = 0;
    async function* concatenated() {
      for (const [index, path] of paths.entries())
        try {
          for await (const chunk of createReadStream(
            path,
          ) as AsyncIterable<Buffer>) {
            hash.update(chunk);
            bytes += chunk.length;
            yield chunk;
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT')
            throw new MissingPartError(index);
          throw error;
        }
    }
    await pipeline(concatenated, createWriteStream(target, { flags: 'wx' }));
    return { bytes, sha256: hash.digest('hex') };
  }

  async remove(sessionId: string): Promise<void> {
    const directory = this.directoryOf(sessionId);
    await assertRealPathInside(this.root, directory);
    await rm(directory, { recursive: true, force: true });
  }

  /** Removes the parts of every session `isOpen` no longer knows (expired, cancelled, lost with Redis); other entries are left alone. */
  async sweep(isOpen: (sessionId: string) => Promise<boolean>): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(resolve(this.root, UPLOADS_DIRECTORY));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries)
      if (UUID_PATTERN.test(entry) && !(await isOpen(entry)))
        await this.remove(entry);
  }

  private directoryOf(sessionId: string): string {
    if (!UUID_PATTERN.test(sessionId))
      throw new Error(`Invalid upload session id: ${sessionId}`);
    return resolveInside(
      this.root,
      `${UPLOADS_DIRECTORY}/${sessionId}`,
      'PROBLEM_DATA_ROOT',
    );
  }

  private partPath(sessionId: string, index: number): string {
    if (!Number.isSafeInteger(index) || index < 0)
      throw new Error(`Invalid chunk index: ${index}`);
    return resolve(this.directoryOf(sessionId), String(index));
  }
}
