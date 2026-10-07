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

export const rejectFile = (message: string) =>
  new AppError('validation_failed', 400, message, { file: [message] });
const tooLarge = (maxBytes: number) =>
  new AppError('file_too_large', 413, `The file exceeds ${maxBytes} bytes`);

/** The multipart contract of every upload route: exactly one file part named `file`, no fields, `maxBytes` per call (overrides the plugin default); `consume` drains the part. */
async function withMultipartFile(
  request: FastifyRequest,
  maxBytes: number,
  consume: (part: MultipartFile) => Promise<void>,
): Promise<string> {
  if (!request.isMultipart()) throw rejectFile('A file is required.');
  let filename: string | undefined;
  try {
    for await (const part of request.parts({
      limits: { files: 1, fields: 0, fileSize: maxBytes },
    })) {
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
  return filename;
}

/** Small files (images, sources): buffered. */
export async function readMultipartFile(
  request: FastifyRequest,
  maxBytes: number,
): Promise<UploadedFile> {
  let content: Buffer = Buffer.alloc(0);
  const filename = await withMultipartFile(request, maxBytes, async (part) => {
    content = await part.toBuffer();
  });
  if (!content.length) throw rejectFile('A non-empty file is required.');
  return { filename, content };
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
    const filename = await withMultipartFile(
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
