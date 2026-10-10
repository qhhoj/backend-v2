import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { PolygonApiError } from './polygon-api.error';

/** Bytes written so far and the size Polygon announced (null without a Content-Length). */
export type DownloadProgress = (done: number, total: number | null) => void;

const MIB = 1024 * 1024;
/** Progress is reported about twenty times per download, and at least every MiB apart. */
const REPORTS_PER_DOWNLOAD = 20;

/** Streams a response body to `destination`, refusing more than `maxBytes` (announced or actual). */
export async function writeCappedBody(
  response: Response,
  destination: string,
  { maxBytes, onProgress }: { maxBytes: number; onProgress?: DownloadProgress },
): Promise<void> {
  const announced = Number(response.headers.get('content-length')) || null;
  if ((announced ?? 0) > maxBytes || !response.body) throw tooLarge(maxBytes);
  const step = Math.max(
    MIB,
    Math.ceil((announced ?? 0) / REPORTS_PER_DOWNLOAD),
  );
  let done = 0;
  let reported = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      done += chunk.length;
      if (done > maxBytes) return callback(tooLarge(maxBytes));
      if (done - reported >= step) {
        reported = done;
        onProgress?.(done, announced);
      }
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
    counter,
    createWriteStream(destination),
  );
  onProgress?.(done, announced ?? done);
}

const tooLarge = (maxBytes: number) =>
  new PolygonApiError(
    'polygon_package_too_large',
    `the package is larger than ${Math.floor(maxBytes / MIB)} MiB`,
  );
