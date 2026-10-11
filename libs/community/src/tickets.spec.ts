import { newTicketDescription } from './tickets';

describe('ticket texts', () => {
  it('cuts the message to 100 code points like legacy but never the title', () => {
    const title = 'T'.repeat(150);
    const description = newTicketDescription({
      title,
      ticketUrl: 'https://oj/ticket/1',
      body: '😀'.repeat(200),
    });
    const [titleLine, messageLine] = description.split('\n');
    expect(titleLine).toBe(`Title: [${title}](https://oj/ticket/1)`);
    expect(Array.from(messageLine)).toHaveLength(100);
    expect(messageLine.startsWith('Message: ')).toBe(true);
  });

  it('escapes link characters so a title cannot rewrite the link target', () => {
    const description = newTicketDescription({
      title: 'a](https://evil) [b',
      ticketUrl: 'https://oj/ticket/1',
      body: 'x',
    });
    expect(description.split('\n')[0]).toBe(
      'Title: [a\\]\\(https://evil\\) \\[b](https://oj/ticket/1)',
    );
  });
});
