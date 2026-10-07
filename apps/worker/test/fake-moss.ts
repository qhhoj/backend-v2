import { createServer } from 'node:net';
import type { AddressInfo, Socket } from 'node:net';

export interface MossSession {
  commands: string[];
  files: Array<{
    index: number;
    language: string;
    name: string;
    content: string;
  }>;
}

const MOSS_LANGUAGES = ['cc', 'python', 'c', 'java', 'pascal'];

async function listen(onConnection: (socket: Socket) => void) {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    onConnection(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** `answer` returns the reply to `query` (a URL), or null to stay silent from the start. */
export async function startFakeMoss(
  answer: (session: MossSession) => string | null,
) {
  const sessions: MossSession[] = [];
  const listening = await listen((socket) => {
    const session: MossSession = { commands: [], files: [] };
    sessions.push(session);
    if (answer(session) === null) return; // silent
    let buffer = Buffer.alloc(0);
    let pending: {
      index: number;
      language: string;
      name: string;
      size: number;
    } | null = null;
    socket.on('error', () => undefined);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (pending) {
          if (buffer.length < pending.size) return;
          const { size, ...file } = pending;
          session.files.push({
            ...file,
            content: buffer.subarray(0, size).toString('utf8'),
          });
          buffer = buffer.subarray(size);
          pending = null;
          continue;
        }
        const end = buffer.indexOf('\n');
        if (end < 0) return;
        const line = buffer.subarray(0, end).toString('utf8');
        buffer = buffer.subarray(end + 1);
        const [command, ...rest] = line.split(' ');
        if (command === 'file')
          pending = {
            index: Number(rest[0]),
            language: rest[1],
            size: Number(rest[2]),
            name: rest.slice(3).join(' '),
          };
        else session.commands.push(line);
        if (command === 'language')
          socket.write(MOSS_LANGUAGES.includes(rest[0]) ? 'yes\n' : 'no\n');
        if (command === 'query') socket.write(`${answer(session)}\n`);
      }
    });
  });
  return { ...listening, sessions };
}

/** A server that never finishes a reply line: one byte every `intervalMs`, forever, so no idle timeout ever fires. */
export function startDripFeedMoss(intervalMs = 20) {
  return listen((socket) => {
    socket.on('error', () => undefined);
    const drip = setInterval(() => socket.write('y'), intervalMs);
    socket.on('close', () => clearInterval(drip));
  });
}

/** Answers `yes` to the language, then closes cleanly (FIN) at the first upload byte. */
export function startClosingMoss() {
  return listen((socket) => {
    socket.on('error', () => undefined);
    let answered = false;
    socket.on('data', () => {
      if (answered) return;
      answered = true;
      socket.write('yes\n', () => socket.end());
    });
  });
}
