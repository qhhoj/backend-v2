import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';

/** Where a zip goes, how much content it may hold, and the error raised past that cap. */
export interface ZipTarget {
  path: string;
  maxBytes: number;
  tooLarge: () => Error;
}

export interface ZipLimits {
  /** Total uncompressed content bytes per zip. */
  maxBytes: number;
  maxEntries: number;
  /** Sources fetched per query; the only sources held in memory. */
  sourceChunk: number;
}

/** yazl asks for each entry's content only when it reaches it, so memory stays at what `contentAt` holds; past `maxBytes` of content the output is destroyed with `tooLarge()` and the partial file is the caller's to remove. */
export async function writeLazyZip(
  names: readonly string[],
  contentAt: (index: number) => Promise<string>,
  target: ZipTarget,
): Promise<void> {
  const { path, maxBytes, tooLarge } = target;
  const zip = new ZipFile();
  const output = zip.outputStream as Readable;
  const fail = (error: unknown) => output.destroy(error as Error);
  zip.on('error', fail);
  let written = 0;
  names.forEach((name, index) =>
    zip.addReadStreamLazy(name, { compress: true }, (callback) => {
      contentAt(index).then((text) => {
        const content = Buffer.from(text);
        written += content.length;
        if (written > maxBytes) return fail(tooLarge());
        callback(null, Readable.from([content]));
      }, fail);
    }),
  );
  zip.end();
  await pipeline(output, createWriteStream(path, { flags: 'wx' }));
}

/** Writes the zip beside `path` and renames it into place; the temporary file never outlives a failure. */
export async function writeZipInPlace(
  names: readonly string[],
  contentAt: (index: number) => Promise<string>,
  target: ZipTarget & { temporaryPath: string },
): Promise<void> {
  const { path, temporaryPath, ...limits } = target;
  try {
    await writeLazyZip(names, contentAt, { ...limits, path: temporaryPath });
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

/** Content by position for a sequence of ids, fetched `chunkSize` at a time and only the current chunk kept; a missing id reads as empty. Positions are read in increasing order. */
export function chunkedSources(
  ids: readonly string[],
  chunkSize: number,
  fetch: (ids: string[]) => Promise<Map<string, string>>,
): (position: number) => Promise<string> {
  let chunkStart = -1;
  let chunk = new Map<string, string>();
  return async (position) => {
    const start = position - (position % chunkSize);
    if (start !== chunkStart) {
      chunk = await fetch(ids.slice(start, start + chunkSize));
      chunkStart = start;
    }
    return chunk.get(ids[position]) ?? '';
  };
}
