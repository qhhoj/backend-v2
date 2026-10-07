import { once } from 'node:events';
import { connect } from 'node:net';
import type { Socket } from 'node:net';

export interface MossServer {
  host: string;
  port: number;
  /** Idle limit per socket: a silent server fails the batch after it. */
  timeoutMs: number;
  /** Wall-clock limit per batch: a server that keeps dripping bytes still fails the batch after it. */
  batchTimeoutMs: number;
}
export const MOSS_SERVER = Symbol('MOSS_SERVER');
export const DEFAULT_MOSS_SERVER: MossServer = {
  host: 'moss.stanford.edu',
  port: 7690,
  timeoutMs: 120_000,
  batchTimeoutMs: 600_000,
};
export interface MossFile {
  name: string;
  content: Buffer;
}
export interface MossRequest {
  /** The MOSS key: written to the socket only, never into a message. */
  userId: string;
  language: string;
  comment: string;
  files: MossFile[];
}
/** Messages are fixed text plus socket error codes: they never hold the key or a server reply. */
export class MossError extends Error {}

const RESULT_URL = /^https?:\/\/moss\.stanford\.edu\/results\/[\w./-]+$/;
const MAX_REPLY_BYTES = 4096;

const connectionFailed = (error: unknown) =>
  new MossError(
    `MOSS connection failed: ${(error as NodeJS.ErrnoException).code ?? 'error'}`,
  );

/** Resolves the next `\n`-terminated reply line; rejects once the socket failed or closed. */
function replyLines(socket: Socket): () => Promise<string> {
  let buffered = '';
  let failure: Error | null = null;
  let waiting: {
    resolve: (line: string) => void;
    reject: (error: Error) => void;
  } | null = null;
  const settle = () => {
    if (!waiting) return;
    const end = buffered.indexOf('\n');
    const current = waiting;
    if (end >= 0) {
      waiting = null;
      current.resolve(buffered.slice(0, end).trim());
      buffered = buffered.slice(end + 1);
    } else if (failure) {
      waiting = null;
      current.reject(failure);
    }
  };
  socket.on('data', (chunk: Buffer) => {
    buffered += chunk.toString('utf8');
    if (buffered.length > MAX_REPLY_BYTES)
      failure ??= new MossError('MOSS replied too much');
    settle();
  });
  socket.on('error', (error) => {
    failure ??= error instanceof MossError ? error : connectionFailed(error);
    settle();
  });
  socket.on('close', () => {
    failure ??= new MossError('MOSS closed the connection');
    settle();
  });
  return () =>
    new Promise((resolve, reject) => {
      waiting = { resolve, reject };
      settle();
    });
}

/** One MOSS batch (mosspy 1.0.9 `Moss.send`). */
export async function submitToMoss(
  server: MossServer,
  { userId, language, comment, files }: MossRequest,
): Promise<string> {
  const socket = connect(server.port, server.host);
  const nextLine = replyLines(socket);
  const timedOut = () => socket.destroy(new MossError('MOSS timed out'));
  socket.setTimeout(server.timeoutMs, timedOut);
  const deadline = setTimeout(timedOut, server.batchTimeoutMs);
  const write = async (chunk: string | Buffer) => {
    if (!socket.write(chunk)) await once(socket, 'drain');
  };
  try {
    await once(socket, 'connect');
    await write(
      `moss ${userId}\ndirectory 0\nX 0\nmaxmatches 10\nshow 100\nlanguage ${language}\n`,
    );
    if ((await nextLine()) !== 'yes')
      throw new MossError(`MOSS refused the language ${language}`);
    for (const [index, file] of files.entries()) {
      await write(
        `file ${index + 1} ${language} ${file.content.length} ${file.name}\n`,
      );
      await write(file.content);
    }
    await write(`query 0 ${comment}\n`);
    const url = await nextLine();
    // Flushed before the socket is torn down below.
    await new Promise<void>((resolve) => socket.end('end\n', () => resolve()));
    if (!RESULT_URL.test(url))
      throw new MossError('MOSS returned no result URL');
    return url;
  } catch (error) {
    throw error instanceof MossError ? error : connectionFailed(error);
  } finally {
    clearTimeout(deadline);
    socket.destroy();
  }
}
