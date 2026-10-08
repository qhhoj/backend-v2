import {
  newTicketDescription,
  problemPath,
  ticketMessageDescription,
  ticketPath,
} from './tickets';

describe('ticket texts', () => {
  it('builds SPA paths and encodes problem codes', () => {
    expect(ticketPath('abc')).toBe('/ticket/abc');
    expect(problemPath('sum_two')).toBe('/problem/sum_two');
    expect(problemPath('a b')).toBe('/problem/a%20b');
  });

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

  it('describes a reply with the prefixed, cut message', () => {
    expect(ticketMessageDescription('hello')).toBe('Message: hello');
    expect(Array.from(ticketMessageDescription('x'.repeat(500)))).toHaveLength(
      100,
    );
  });
});
