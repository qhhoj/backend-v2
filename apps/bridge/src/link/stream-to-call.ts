import { once } from 'node:events';
import type { EventEmitter } from 'node:events';
import type { ServerWritableStream } from '@grpc/grpc-js';
import type { Chunk } from '@libs/judge-proto';
import { SOURCE_CHUNK_BYTES } from './link-limits';

/** Waits for the judge to drain the call; false when the call ends first (grpc-js emits only `close` on a cancel, which `once(call, 'drain')` would wait on forever). */
async function drained(call: EventEmitter): Promise<boolean> {
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

function* pieces(data: Buffer): Generator<Buffer> {
  for (let at = 0; at < data.length; at += SOURCE_CHUNK_BYTES)
    yield data.subarray(at, at + SOURCE_CHUNK_BYTES);
}

/** Writes `source` to the call in chunks of at most 1 MiB, waiting for the judge to drain each (HTTP/2 flow control), then ends it; a cancelled call stops reading and is not ended. */
export async function streamToCall(
  call: ServerWritableStream<unknown, Chunk>,
  source: AsyncIterable<Buffer>,
): Promise<void> {
  for await (const data of source)
    for (const part of pieces(data)) {
      if (call.cancelled) return;
      if (!call.write({ data: part }) && !(await drained(call))) return;
    }
  call.end();
}
