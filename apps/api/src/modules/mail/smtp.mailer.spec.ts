import { createServer, Server, Socket } from 'node:net';
import { fakeSettings } from '@libs/settings/testing';
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
  new SmtpMailer(fakeSettings({ 'mail.smtpUrl': `smtp://127.0.0.1:${port}` }));
const rcpts = (commands: string[]) =>
  commands.filter((line) => line.startsWith('RCPT'));

describe('SmtpMailer', () => {
  let sink: Awaited<ReturnType<typeof startSink>>;
  beforeAll(async () => {
    sink = await startSink();
  });
  afterAll(() => sink.stop());
  beforeEach(() => {
    sink.received.length = 0;
    sink.commands.length = 0;
  });

  it('delivers subject, body and the From address, which follows the setting live', async () => {
    const settings = fakeSettings({
      'mail.smtpUrl': `smtp://127.0.0.1:${sink.port}`,
      'mail.from': 'QHHOJ <noreply@example.test>',
    });
    const mailer = new SmtpMailer(settings);
    await mailer.send({ to: 'bob@example.com', subject: 'Hello', text: 'Hi' });
    settings.override('mail.from', 'Ops <ops@example.test>');
    await mailer.send({ to: 'bob@example.com', subject: 's', text: 'b' });
    expect(sink.received[0]).toContain('Subject: Hello');
    expect(sink.received[0]).toContain('From: QHHOJ <noreply@example.test>');
    expect(sink.received[1]).toContain('From: Ops <ops@example.test>');
  });

  it('switches to a new server when the URL setting changes, without a restart', async () => {
    const second = await startSink();
    try {
      const settings = fakeSettings({
        'mail.smtpUrl': `smtp://127.0.0.1:${sink.port}`,
      });
      const mailer = new SmtpMailer(settings);
      await mailer.send({ to: 'bob@example.com', subject: 'one', text: 'a' });
      settings.override('mail.smtpUrl', `smtp://127.0.0.1:${second.port}`);
      await mailer.send({ to: 'bob@example.com', subject: 'two', text: 'b' });
      expect(sink.received).toHaveLength(1);
      expect(second.received).toHaveLength(1);
    } finally {
      await second.stop();
    }
  });

  it('refuses to send while no SMTP URL is configured', async () => {
    await expect(
      new SmtpMailer(fakeSettings()).send({
        to: 'bob@example.com',
        subject: 's',
        text: 'b',
      }),
    ).rejects.toThrow('Mail is not configured');
  });

  it('sends one RCPT for a plus-tagged address', async () => {
    await mailerFor(sink.port).send({
      to: 'bob+tag@example.com',
      subject: 's',
      text: 'body',
    });
    expect(rcpts(sink.commands)).toEqual(['RCPT TO:<BOB+TAG@EXAMPLE.COM>']);
  });

  it.each([
    'bob@example.com, evil@attacker.test',
    'Bob <bob@example.com>',
    'bob@example.com\r\nBcc: evil@attacker.test',
    'bob@localhost',
    'x:bob@example.com',
    'b\x01ob@example.com',
    'bob%evil.test@example.com',
    '',
  ])('rejects recipient %j without connecting', async (to) => {
    await expect(
      mailerFor(sink.port).send({ to, subject: 's', text: 'body' }),
    ).rejects.toThrow('Invalid mail recipient');
    expect(sink.commands).toEqual([]);
  });

  it.each(['s\r\nBcc: evil@attacker.test', 's\0x'])(
    'rejects subject %j without connecting',
    async (subject) => {
      await expect(
        mailerFor(sink.port).send({
          to: 'bob@example.com',
          subject,
          text: 'body',
        }),
      ).rejects.toThrow('Invalid mail subject');
      expect(sink.commands).toEqual([]);
    },
  );
});
