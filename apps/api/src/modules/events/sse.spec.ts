import { once } from 'node:events';
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

/** A client that reads, but only on a later tick (a healthy slow-ish socket). */
class DrainingResponse extends StalledResponse {
  override _write(...args: unknown[]): void {
    setImmediate(args[2] as () => void);
  }
}

describe('openEventStream', () => {
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

  it('keeps a client that reads, however many frames one tick writes', async () => {
    const raw = new DrainingResponse();
    const stream = openEventStream(replyOn(raw), 64 * 1024, 60_000);
    for (let sent = 0; sent < 200; sent += 1)
      stream.send(sseFrame('done', { sent }));
    await once(raw, 'drain'); // the client read everything; no wall-clock wait
    expect(raw.writableLength).toBe(0);
    expect(raw.destroyed).toBe(false);
    stream.close();
  });

  it('drops a client that never drains once the grace period ends, before any byte cap', async () => {
    const raw = new StalledResponse();
    const stream = openEventStream(replyOn(raw), 1024 * 1024, 20);
    stream.send(sseFrame('done', { padding: 'x'.repeat(100) }));
    expect(raw.destroyed).toBe(false);
    await stream.closed;
    expect(raw.destroyed).toBe(true);
  });

  it('is closed from the start when the client left before the stream opened', async () => {
    const raw = new StalledResponse();
    raw.destroy();
    await new Promise((resolve) => raw.once('close', resolve));
    const writeHead = jest.spyOn(raw, 'writeHead');
    const stream = openEventStream(replyOn(raw), 1024, 20);
    await expect(stream.closed).resolves.toBeUndefined();
    expect(writeHead).not.toHaveBeenCalled();
  });

  it('drops a client whose backlog stays high although it keeps draining a little', async () => {
    class TrickleResponse extends StalledResponse {
      constructor() {
        super();
        Object.defineProperty(this, 'writableLength', { value: 20 * 1024 });
      }
      override write(): boolean {
        return true;
      }
    }
    const raw = new TrickleResponse();
    const stream = openEventStream(replyOn(raw), 1024 * 1024, 40);
    stream.send(sseFrame('done', {}));
    const trickle = setInterval(() => raw.emit('drain'), 10);
    await stream.closed.finally(() => clearInterval(trickle));
    expect(raw.destroyed).toBe(true);
  });
});
