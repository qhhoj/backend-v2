import { InMemoryMailer } from './in-memory.mailer';
import { assertMailMessage } from './mailer';

const message = (to: string, subject = 'Hello') => ({
  to,
  subject,
  text: 'body',
});

describe('assertMailMessage', () => {
  it.each(['a@example.com', 'First.Last+tag@mail.example.org', 'a_b-c@x-y.io'])(
    'accepts the bare address %s',
    (to) => expect(() => assertMailMessage(message(to))).not.toThrow(),
  );

  it.each([
    '',
    'Name <a@example.com>',
    'a@example.com, b@example.com',
    '"a b"@example.com',
    'a@localhost',
    'a@example.com\r\nBcc: x@example.com',
    'a@exämple.com',
  ])('refuses the recipient %j', (to) =>
    expect(() => assertMailMessage(message(to))).toThrow(
      'Invalid mail recipient',
    ),
  );

  it('refuses a subject with a control character and accepts other text', () => {
    expect(() =>
      assertMailMessage(message('a@example.com', 'Hi\r\nBcc: x')),
    ).toThrow('Invalid mail subject');
    expect(() =>
      assertMailMessage(message('a@example.com', 'Chào bạn')),
    ).not.toThrow();
  });
});

describe('InMemoryMailer', () => {
  it('keeps what a real transport would send and rejects what it would refuse', async () => {
    const mailer = new InMemoryMailer();
    await mailer.send(message('a@example.com'));
    await expect(mailer.send(message('bad'))).rejects.toThrow(
      'Invalid mail recipient',
    );
    expect(mailer.sent).toHaveLength(1);
  });
});
