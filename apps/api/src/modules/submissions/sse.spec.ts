import { Writable } from 'node:stream';
import type { FastifyReply } from 'fastify';
import { openEventStream, sseFrame } from './sse';

/** A response whose client never reads: nothing written ever leaves its buffer. */
class StalledResponse extends Writable {
  statusCode = 0;
  headers: Record<string, unknown> = {};
  constructor() {
    super({ highWaterMark: 16 });
  }
  writeHead(statusCode: number, headers: Record<string, unknown>): this {
    this.statusCode = statusCode;
    this.headers = headers;
    return this;
  }
  override _write(): void {
    // never calls back
  }
}

const replyOn = (raw: StalledResponse, hijack = jest.fn()) =>
  ({
    hijack,
    getHeaders: () => ({ 'x-request-id': 'req-1' }),
    raw,
  }) as unknown as FastifyReply;

describe('openEventStream', () => {
  it('takes the response over with event-stream headers, keeping the reply headers', () => {
    const raw = new StalledResponse();
    const hijack = jest.fn();
    openEventStream(replyOn(raw, hijack), 1024);
    expect(hijack).toHaveBeenCalledTimes(1);
    expect(raw.statusCode).toBe(200);
    expect(raw.headers).toMatchObject({
      'x-request-id': 'req-1',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    });
  });

  it('frames an event as SSE', () =>
    expect(sseFrame('done', { status: 'D' })).toBe(
      'event: done\ndata: {"status":"D"}\n\n',
    ));

  it('drops a client that stops reading once its unsent bytes pass the cap', async () => {
    const raw = new StalledResponse();
    const stream = openEventStream(replyOn(raw), 1024);
    const frame = sseFrame('test-case', { padding: 'x'.repeat(80) });
    let maxBuffered = 0;
    for (let sent = 0; sent < 1000; sent += 1) {
      stream.send(frame);
      maxBuffered = Math.max(maxBuffered, raw.writableLength);
    }
    expect(maxBuffered).toBeLessThanOrEqual(1024);
    expect(raw.destroyed).toBe(true);
    await expect(stream.closed).resolves.toBeUndefined();
  });

  it('ignores sends after the stream closed', async () => {
    const raw = new StalledResponse();
    const failed = jest.fn();
    raw.on('error', failed);
    const stream = openEventStream(replyOn(raw), 1024);
    stream.close();
    expect(() => stream.send(sseFrame('done', {}))).not.toThrow();
    await stream.closed;
    expect(failed).not.toHaveBeenCalled();
  });
});
