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

export interface CappedBodyOptions {
  maxBytes: number;
  onProgress?: DownloadProgress;
  /** Called on every chunk received, so an idle timer can be re-armed. */
  onData?: () => void;
}

/** Counts the bytes passing through, refusing more than `maxBytes`, and reports progress about twenty times. */
class ByteCounter extends Transform {
  done = 0;
  private reported = 0;
  private readonly step: number;

  constructor(
    private readonly announced: number | null,
    private readonly options: CappedBodyOptions,
  ) {
    super();
    this.step = Math.max(
      MIB,
      Math.ceil((announced ?? 0) / REPORTS_PER_DOWNLOAD),
    );
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ): void {
    this.options.onData?.();
    this.done += chunk.length;
    if (this.done > this.options.maxBytes)
      return callback(tooLarge(this.options.maxBytes));
    if (this.done - this.reported >= this.step) {
      this.reported = this.done;
      this.options.onProgress?.(this.done, this.announced);
    }
    callback(null, chunk);
  }
}

/** Streams a response body to `destination`, refusing more than `maxBytes` (announced or actual). A body that breaks off (reset, idle timeout) is `polygon_unavailable`, naming how far it got. */
export async function writeCappedBody(
  response: Response,
  destination: string,
  options: CappedBodyOptions,
): Promise<void> {
  const announced = Number(response.headers.get('content-length')) || null;
  if ((announced ?? 0) > options.maxBytes || !response.body)
    throw tooLarge(options.maxBytes);
  const counter = new ByteCounter(announced, options);
  try {
    await pipeline(
      Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
      counter,
      createWriteStream(destination),
    );
  } catch (error) {
    if (error instanceof PolygonApiError) throw error;
    throw new PolygonApiError(
      'polygon_unavailable',
      `the download stopped after ${(counter.done / MIB).toFixed(1)} MiB: ${failureTextOf(error)}`,
    );
  }
  options.onProgress?.(counter.done, announced ?? counter.done);
}

/** Aborts a download that received nothing for `ms`; a slow download that keeps moving is never cut. */
export class IdleWatch {
  private readonly controller = new AbortController();
  private timer: NodeJS.Timeout;

  constructor(private readonly ms: number) {
    this.timer = this.arm();
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  touch(): void {
    clearTimeout(this.timer);
    this.timer = this.arm();
  }

  stop(): void {
    clearTimeout(this.timer);
  }

  private arm(): NodeJS.Timeout {
    return setTimeout(
      () =>
        this.controller.abort(
          new DOMException(`no data for ${this.ms} ms`, 'TimeoutError'),
        ),
      this.ms,
    ).unref();
  }
}

/** Why a request or a body stream failed: a timeout (a DOMException, not always an `Error` here), or the network error code (ENOTFOUND, ECONNRESET, a TLS code...). */
export function failureTextOf(error: unknown): string {
  const { name, message, code, cause } = (error ?? {}) as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    cause?: { code?: unknown; message?: unknown };
  };
  if (name === 'TimeoutError') return 'timed out';
  if (typeof cause?.code === 'string') return cause.code;
  if (typeof code === 'string' && code !== 'ABORT_ERR') return code;
  if (typeof cause?.message === 'string') return cause.message;
  return typeof message === 'string' ? message : 'unknown error';
}

const tooLarge = (maxBytes: number) =>
  new PolygonApiError(
    'polygon_package_too_large',
    `the package is larger than ${Math.floor(maxBytes / MIB)} MiB`,
  );
