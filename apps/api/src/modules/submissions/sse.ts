import type { OutgoingHttpHeaders } from 'node:http';
import type { FastifyReply } from 'fastify';

/** `X-Accel-Buffering: no` keeps nginx from holding events back. */
export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;
/** EventSource waits this long before reconnecting. */
export const RECONNECT_DELAY_MS = 3000;
/** A comment line: keeps proxies from closing an idle stream and finds dead sockets. */
export const HEARTBEAT_FRAME = ': ping\n\n';

export const sseFrame = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export interface EventStream {
  send(frame: string): void;
  close(): void;
  /** Resolves once the connection closed, whoever closed it. */
  readonly closed: Promise<void>;
}

/** How long a client may leave a write undrained before it counts as stalled. */
export const DRAIN_GRACE_MS = 2000;
/** TCP keepalive probe delay: finds a peer that vanished without closing. */
const KEEPALIVE_MS = 30_000;

/** Takes the response over from Fastify (`hijack`), keeping the headers already on the reply (CORS, request id). A hijacked reply skips `onSend`, so `@fastify/cookie` never writes a cookie set before it: a stream must not depend on a cookie refresh. A client is dropped when a write stays undrained for `drainGraceMs` (a burst written in one tick is not a stall: Node holds it until the tick ends), or at once when its unsent bytes would pass `maxBufferedBytes`, the memory bound. The kernel socket buffers hold more on top of it. Its EventSource reconnects and starts again from the current state. A client that left before this call is closed from the start. */
export function openEventStream(
  reply: FastifyReply,
  maxBufferedBytes: number,
  drainGraceMs = DRAIN_GRACE_MS,
): EventStream {
  reply.hijack();
  const response = reply.raw;
  const closed =
    response.destroyed || response.closed
      ? Promise.resolve()
      : new Promise<void>((resolve) => response.once('close', () => resolve()));
  let stallTimer: NodeJS.Timeout | undefined;
  const stopStallTimer = () => {
    clearTimeout(stallTimer);
    stallTimer = undefined;
  };
  const close = () => {
    stopStallTimer();
    response.destroy();
  };
  if (!response.destroyed) {
    response.on('error', close);
    response.on('drain', stopStallTimer);
    void closed.then(stopStallTimer);
    response.socket?.setKeepAlive(true, KEEPALIVE_MS);
    response.writeHead(200, {
      ...(reply.getHeaders() as OutgoingHttpHeaders),
      ...SSE_HEADERS,
    });
    response.write(`retry: ${RECONNECT_DELAY_MS}\n\n`);
  }
  return {
    closed,
    close,
    send(frame) {
      if (response.destroyed) return;
      if (response.writableLength + Buffer.byteLength(frame) > maxBufferedBytes)
        return close();
      if (!response.write(frame) && !stallTimer)
        stallTimer = setTimeout(close, drainGraceMs);
    },
  };
}
