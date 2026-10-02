import { createServer, Server, Socket } from 'node:net';
import { loadEnv } from '../env/env';
import { validEnv } from '../env/env.fixture';
import { SmtpMailer } from './smtp.mailer';

/** Minimal SMTP sink: records every DATA payload it receives. */
function startSink() {
  const received: string[] = [];
  const commands: string[] = [];
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
        commands.push(line);
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
    commands: string[];
    stop: () => Promise<void>;
  }>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        port: (server.address() as { port: number }).port,
        received,
        commands,
        stop: () =>
          new Promise<void>((done) => {
            sockets.forEach((socket) => socket.destroy());
            server.close(() => done());
          }),
      }),
    ),
  );
}

const mailerFor = (port: number) =>
  new SmtpMailer(
    loadEnv({ ...validEnv, SMTP_URL: `smtp://127.0.0.1:${port}` }),
  );

describe('SmtpMailer', () => {
  const optionsFor = (smtpUrl: string) =>
    new SmtpMailer(loadEnv({ ...validEnv, SMTP_URL: smtpUrl }))
      .transportOptions;

  it('applies default transport timeouts', () => {
    expect(optionsFor('smtp://localhost:1025')).toMatchObject({
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  });
  it('lets SMTP_URL override a timeout', () => {
    expect(
      optionsFor('smtp://localhost:1025?socketTimeout=5000'),
    ).toMatchObject({ connectionTimeout: 10000, socketTimeout: 5000 });
  });

  it('delivers subject, body and configured From over SMTP', async () => {
    const sink = await startSink();
    try {
      const mailer = new SmtpMailer(
        loadEnv({
          ...validEnv,
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

  it('sends one RCPT TO for a valid address', async () => {
    const sink = await startSink();
    try {
      await mailerFor(sink.port).send({
        to: 'bob@example.com',
        subject: 'Hello',
        text: 'body',
      });
      expect(sink.commands.filter((line) => line.startsWith('RCPT'))).toEqual([
        'RCPT TO:<BOB@EXAMPLE.COM>',
      ]);
    } finally {
      await sink.stop();
    }
  });

  it.each([
    ['bob+tag@example.com', 'BOB+TAG@EXAMPLE.COM'],
    ['first.last@sub.example.co', 'FIRST.LAST@SUB.EXAMPLE.CO'],
  ])('sends to allowed address %s', async (to, expected) => {
    const sink = await startSink();
    try {
      await mailerFor(sink.port).send({ to, subject: 's', text: 'body' });
      expect(sink.commands.filter((line) => line.startsWith('RCPT'))).toEqual([
        `RCPT TO:<${expected}>`,
      ]);
    } finally {
      await sink.stop();
    }
  });

  it.each([
    'bob@example.com, evil@attacker.test',
    'bob@example.com; evil@x.test',
    'Bob <bob@example.com>',
    'bob@example.com\tevil',
    'bob@example.com\r\nBcc: evil@attacker.test',
    'bob@localhost',
    'x:bob@example.com',
    'bob@example.com:x',
    'b\x01ob@example.com',
    'b\x7fob@example.com',
    'bob@ex\uff0cample.com',
    'bob%evil.test@example.com',
    '',
  ])('rejects recipient %j without connecting', async (to) => {
    const sink = await startSink();
    try {
      await expect(
        mailerFor(sink.port).send({ to, subject: 's', text: 'body' }),
      ).rejects.toThrow('Invalid mail recipient');
      expect(sink.commands).toEqual([]);
    } finally {
      await sink.stop();
    }
  });

  it.each(['s\r\nBcc: evil@attacker.test', 's\0x', 's\x7f'])(
    'rejects subject %j without connecting',
    async (subject) => {
      const sink = await startSink();
      try {
        await expect(
          mailerFor(sink.port).send({
            to: 'bob@example.com',
            subject,
            text: 'body',
          }),
        ).rejects.toThrow('Invalid mail subject');
        expect(sink.commands).toEqual([]);
      } finally {
        await sink.stop();
      }
    },
  );
});
