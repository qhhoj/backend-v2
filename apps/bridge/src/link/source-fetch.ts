import { status } from '@grpc/grpc-js';
import type { ServerWritableStream } from '@grpc/grpc-js';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { once } from 'node:events';
import type { EventEmitter } from 'node:events';
import { constants } from 'node:fs';
import type { ReadStream } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ENV, MAX_UPLOAD_BYTES } from '@libs/common';
import type { Env } from '@libs/common';
import { isUuid } from '@libs/database';
import type {
  AssignmentRef,
  Chunk,
  FetchSourceRequest,
} from '@libs/judge-proto';
import type { DispatchTarget } from '../dispatch/slots';
import { submissionFilePath } from '../submissions/submission-file-path';
import { SubmissionsRepository } from '../submissions/submissions.repository';
import { SOURCE_CHUNK_BYTES } from './link-limits';

export type SourceCall = ServerWritableStream<FetchSourceRequest, Chunk>;
/** The calling judge's live session, as far as FetchSource needs it. */
export type SourceHolder = Pick<DispatchTarget, 'id' | 'inFlight'>;

/** The requested ref when the calling judge's live session holds it and the request names that session. */
function heldRef(
  holder: SourceHolder | undefined,
  { ref, sessionId }: FetchSourceRequest,
): AssignmentRef | null {
  if (!holder || !ref || !isUuid(ref.submissionId)) return null;
  if (sessionId !== holder.id) return null;
  // Generation 0 is a claim still in flight, not yet a run of this session.
  if (ref.generation === 0) return null;
  return holder.inFlight.get(ref.submissionId) === ref.generation ? ref : null;
}

/** Waits for the judge to drain the call; false when the call ends first (grpc-js emits only `close` on a cancel, which `once(call, 'drain')` would wait on forever). */
export async function drained(call: EventEmitter): Promise<boolean> {
  const stop = new AbortController();
  const ended = ['cancelled', 'close', 'error'].map((event) =>
    once(call, event, { signal: stop.signal }).then(() => false),
  );
  try {
    return await Promise.race([
      once(call, 'drain', { signal: stop.signal }).then(() => true),
      ...ended,
    ]);
  } finally {
    stop.abort();
  }
}

/** Destroys the stream and waits for its `close`: a read still in flight holds the handle, and `FileHandle.close()` then resolves before the descriptor is really closed. */
async function destroyed(file: ReadStream): Promise<void> {
  // a plain listener, not `once()`: that rejects on the abort error a destroyed iterator emits, before `close`
  const closed = file.closed
    ? Promise.resolve()
    : new Promise<void>((resolve) => file.once('close', () => resolve()));
  file.destroy();
  await closed;
}

/** FetchSource: the file of a file-only submission, only for a run the calling judge's live session holds (otherwise any judge key could read any user's upload). Judges need no HTTP access to the site. */
@Injectable()
export class SourceFetch {
  private readonly logger = new Logger(SourceFetch.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly submissions: SubmissionsRepository,
  ) {}

  async serve(
    call: SourceCall,
    holder: SourceHolder | undefined,
  ): Promise<void> {
    const ref = heldRef(holder, call.request);
    if (!ref)
      return this.refuse(
        call,
        status.PERMISSION_DENIED,
        'not a run of this session',
      );
    const path = await this.pathOf(ref.submissionId);
    const upload = path ? await this.openUpload(path) : null;
    if (!path || !upload)
      return this.refuse(call, status.NOT_FOUND, 'no uploaded file');
    const { handle, size } = upload;
    try {
      if (size > MAX_UPLOAD_BYTES)
        return this.refuse(
          call,
          status.FAILED_PRECONDITION,
          'file over the upload cap',
        );
      await this.stream(call, handle, path);
    } finally {
      await handle.close();
    }
  }

  private async pathOf(submissionId: string): Promise<string | null> {
    const url = await this.submissions.sourceOf(submissionId);
    return url ? submissionFilePath(this.env, url) : null;
  }

  /** A regular file whose parent resolves inside `submission_file/`, opened without following a symlink at the last component; the size check and the stream use this one handle (no reopen between check and read). Null otherwise. */
  private async openUpload(
    path: string,
  ): Promise<{ handle: FileHandle; size: number } | null> {
    const missing = () => null;
    const root = await realpath(
      join(this.env.mediaRoot, 'submission_file'),
    ).catch(missing);
    const parent = await realpath(dirname(path)).catch(missing);
    if (!root || !parent?.startsWith(`${root}/`)) return null;
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    ).catch(missing);
    if (!handle) return null;
    const stats = await handle.stat();
    if (stats.isFile()) return { handle, size: stats.size };
    await handle.close();
    return null;
  }

  /** Chunks of at most 1 MiB, waiting for the judge to drain each (HTTP/2 flow control); a cancelled call stops reading. The caller closes `handle`. */
  private async stream(
    call: SourceCall,
    handle: FileHandle,
    path: string,
  ): Promise<void> {
    const file = handle.createReadStream({
      highWaterMark: SOURCE_CHUNK_BYTES,
      autoClose: false,
    });
    try {
      for await (const data of file as AsyncIterable<Buffer>) {
        if (call.cancelled) return;
        if (!call.write({ data }) && !(await drained(call))) return;
      }
      call.end();
    } catch (error) {
      this.logger.error(
        `FetchSource of ${path} failed: ${(error as Error).message}`,
      );
      this.refuse(call, status.INTERNAL, 'reading the file failed');
    } finally {
      await destroyed(file);
    }
  }

  private refuse(call: SourceCall, code: status, details: string): void {
    call.emit('error', { code, details });
  }
}
