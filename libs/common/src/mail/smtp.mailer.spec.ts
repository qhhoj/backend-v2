import { createServer, Server, Socket } from 'node:net';
import { loadEnv } from '../env/env';
import { SmtpMailer } from './smtp.mailer';

const baseEnv = {
  MONGO_URL: 'mongodb://localhost/qhhoj',
  REDIS_URL: 'redis://localhost:6379',
  ENCRYPTION_KEY: 'ab'.repeat(32),
  TOKEN_SECRET: 'x'.repeat(32),
  SITE_URL: 'http://localhost:3000',
};

/** Minimal SMTP sink: records every DATA payload it receives. */
function startSink() {
  const received: string[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let inData = false;
    let data = '';
    let buffer = '';
    socket.write('220 sink ready\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (inData) {
        data += buffer;
        buffer = '';
        if (data.endsWith('\r\n.\r\n')) {
          received.push(data);
          inData = false;
          data = '';
          socket.write('250 queued\r\n');
        }
        return;
      }
      let index: number;
      while (!inData && (index = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, index).toUpperCase();
        buffer = buffer.slice(index + 2);
        if (line.startsWith('DATA')) {
          inData = true;
          socket.write('354 go ahead\r\n');
          data = buffer;
          buffer = '';
          if (data.endsWith('\r\n.\r\n')) {
            received.push(data);
            inData = false;
            data = '';
            socket.write('250 queued\r\n');
          }
        } else if (line.startsWith('QUIT')) socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  return new Promise<{
    port: number;
    received: string[];
    stop: () => Promise<void>;
  }>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        port: (server.address() as { port: number }).port,
        received,
        stop: () =>
          new Promise<void>((done) => {
            sockets.forEach((socket) => socket.destroy());
            server.close(() => done());
          }),
      }),
    ),
  );
}

describe('SmtpMailer', () => {
  it('delivers subject, body and configured From over SMTP', async () => {
    const sink = await startSink();
    try {
      const mailer = new SmtpMailer(
        loadEnv({
          ...baseEnv,
          SMTP_URL: `smtp://127.0.0.1:${sink.port}`,
          MAIL_FROM: 'QHHOJ <noreply@example.test>',
        }),
      );
      await mailer.send({
        to: 'bob@example.com',
        subject: 'Hello',
        text: 'Verify your account please',
      });
      expect(sink.received).toHaveLength(1);
      expect(sink.received[0]).toContain('Subject: Hello');
      expect(sink.received[0]).toContain('Verify your account please');
      expect(sink.received[0]).toContain('From: QHHOJ <noreply@example.test>');
      expect(sink.received[0]).toContain('To: bob@example.com');
    } finally {
      await sink.stop();
    }
  });
});
