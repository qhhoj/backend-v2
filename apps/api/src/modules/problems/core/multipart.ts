import type { MultipartFile } from '@fastify/multipart';
import type { FastifyRequest } from 'fastify';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { AppError } from '@libs/common';

export interface UploadedFile {
  filename: string;
  content: Buffer;
}

/** An uploaded file plus the text fields sent with it. */
export interface UploadedForm extends UploadedFile {
  fields: Record<string, string>;
}

/** Text fields carry ids and names, never content. */
const FIELD_MAX_BYTES = 256;

export const rejectFile = (message: string) =>
  new AppError('validation_failed', 400, message, { file: [message] });
export const tooLarge = (maxBytes: number) =>
  new AppError('file_too_large', 413, `The file exceeds ${maxBytes} bytes`);

/** The multipart contract of every upload route: exactly one file part named `file`, at most one of each of `fieldNames` (none by default), `maxBytes` per call (overrides the plugin default); `consume` drains the part. */
async function withMultipartFile(
  request: FastifyRequest,
  maxBytes: number,
  consume: (part: MultipartFile) => Promise<void>,
  fieldNames: readonly string[] = [],
): Promise<{ filename: string; fields: Record<string, string> }> {
  if (!request.isMultipart()) throw rejectFile('A file is required.');
  let filename: string | undefined;
  const fields: Record<string, string> = {};
  try {
    for await (const part of request.parts({
      limits: {
        files: 1,
        fields: fieldNames.length,
        fileSize: maxBytes,
        fieldSize: FIELD_MAX_BYTES,
      },
    })) {
      if (part.type === 'field') {
        if (
          !fieldNames.includes(part.fieldname) ||
          part.fieldname in fields ||
          part.valueTruncated
        )
          throw rejectFile('Unexpected, repeated or oversized field.');
        fields[part.fieldname] = String(part.value);
        continue;
      }
      if (
        part.type !== 'file' ||
        part.fieldname !== 'file' ||
        filename !== undefined
      )
        throw rejectFile('Send exactly one file in the "file" field.');
      filename = part.filename;
      await consume(part);
      if (part.file.truncated) throw tooLarge(maxBytes);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE')
      throw tooLarge(maxBytes);
    throw rejectFile('The upload is malformed.');
  }
  if (filename === undefined) throw rejectFile('A file is required.');
  return { filename, fields };
}

/** Small files (images, sources): buffered. */
export async function readMultipartFile(
  request: FastifyRequest,
  maxBytes: number,
): Promise<UploadedFile> {
  const { filename, content } = await readMultipartForm(request, maxBytes, []);
  return { filename, content };
}

/** A small file sent with the text fields `fieldNames` (any order, each optional; the caller validates them): buffered. */
export async function readMultipartForm(
  request: FastifyRequest,
  maxBytes: number,
  fieldNames: readonly string[],
): Promise<UploadedForm> {
  let content: Buffer = Buffer.alloc(0);
  const { filename, fields } = await withMultipartFile(
    request,
    maxBytes,
    async (part) => {
      content = await part.toBuffer();
    },
    fieldNames,
  );
  if (!content.length) throw rejectFile('A non-empty file is required.');
  return { filename, content, fields };
}

/** Large files (archives, packages): streamed to `targetPath`, which is removed again on any failure, including a truncated upload. `checkFilename` runs before the stream is consumed and rejects by throwing. */
export async function saveMultipartFile(
  request: FastifyRequest,
  maxBytes: number,
  targetPath: string,
  checkFilename?: (filename: string) => void,
): Promise<{ filename: string; bytes: number }> {
  let bytes = 0;
  try {
    const { filename } = await withMultipartFile(
      request,
      maxBytes,
      async (part) => {
        checkFilename?.(part.filename);
        part.file.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
        });
        await pipeline(part.file, createWriteStream(targetPath));
      },
    );
    if (!bytes) throw rejectFile('A non-empty file is required.');
    return { filename, bytes };
  } catch (error) {
    await rm(targetPath, { force: true });
    throw error;
  }
}
