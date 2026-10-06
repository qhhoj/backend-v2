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

/** Takes the response over from Fastify (`hijack`), keeping the headers already on the reply (CORS, request id). A hijacked reply skips `onSend`, so `@fastify/cookie` never writes a cookie set before it: a stream must not depend on a cookie refresh. A client that stops reading is dropped as soon as its unsent bytes would pass `maxBufferedBytes`; its EventSource reconnects and starts again from the current state. */
export function openEventStream(
  reply: FastifyReply,
  maxBufferedBytes: number,
): EventStream {
  reply.hijack();
  const response = reply.raw;
  response.writeHead(200, {
    ...(reply.getHeaders() as OutgoingHttpHeaders),
    ...SSE_HEADERS,
  });
  response.write(`retry: ${RECONNECT_DELAY_MS}\n\n`);
  const closed = new Promise<void>((resolve) =>
    response.once('close', () => resolve()),
  );
  const close = () => {
    response.destroy();
  };
  response.on('error', close);
  return {
    closed,
    close,
    send(frame) {
      if (response.destroyed) return;
      if (
        response.writableLength + Buffer.byteLength(frame) >
        maxBufferedBytes
      ) {
        close();
        return;
      }
      response.write(frame);
    },
  };
}
