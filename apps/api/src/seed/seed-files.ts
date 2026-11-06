import { readFile } from 'node:fs/promises';
import { ZipFile } from 'yazl';
import { atomicWrite } from '@libs/common';

/** Fixed entry mtime so two seed runs build byte-identical zips. */
const ZIP_MTIME = new Date('2026-01-01T00:00:00Z');

/** The zip of `files`, entries sorted by name, as bytes. */
export async function zipBytes(files: Record<string, string>): Promise<Buffer> {
  const zip = new ZipFile();
  for (const [name, content] of Object.entries(files).sort(([left], [right]) =>
    left.localeCompare(right),
  ))
    zip.addBuffer(Buffer.from(content), name, { mtime: ZIP_MTIME });
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** Writes `content` unless the file already holds it; a reader of a live stack never sees a torn file. */
export async function writeIfChanged(
  path: string,
  content: string | Buffer,
): Promise<void> {
  const bytes = Buffer.from(content);
  const current = await readFile(path).catch(() => null);
  if (current?.equals(bytes)) return;
  await atomicWrite(path, bytes);
}
