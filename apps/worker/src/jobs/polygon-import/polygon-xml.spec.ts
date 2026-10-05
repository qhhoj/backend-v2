import {
  childOf,
  childText,
  descendant,
  descendants,
  parseXml,
  XML_LIMITS,
  XmlError,
} from './polygon-xml';

const SMALL = 10_000;
const LARGE = 100_000;
const FLOOD = 500_000;
/** Slack over perfectly linear growth. */
const LINEAR_SLACK = 4;
/** Linear work: ten times the input may cost ten times the time; the cap leaves room for noisy runners. */
const LINEAR_RATIO_CAP = 40;

const timed = (work: () => unknown): number => {
  const started = performance.now();
  work();
  return Math.max(performance.now() - started, 1);
};
const testElements = (count: number) =>
  `<problem><judging><testset name="tests"><tests>${'<test method="manual" points="1.5" group="g1"/>'.repeat(count)}</tests></testset></judging></problem>`;

describe('parseXml', () => {
  it('builds a tree with attributes, text and decoded entities', () => {
    const root = parseXml(
      '<?xml version="1.0"?><problem short-name="a&amp;b"><judging><testset name="tests"><time-limit> 1000 </time-limit></testset></judging><names><name language="english" value="Sum"/></names></problem>',
    );
    expect(root.name).toBe('problem');
    expect(root.attributes['short-name']).toBe('a&b');
    const testset = descendant(
      root,
      'testset',
      (candidate) => candidate.attributes.name === 'tests',
    );
    expect(childText(testset!, 'time-limit')).toBe('1000');
    expect(
      childOf(root, 'judging')?.children.map((child) => child.name),
    ).toEqual(['testset']);
    expect(
      descendants(root, 'name').map((name) => name.attributes.value),
    ).toEqual(['Sum']);
    expect(descendant(root, 'missing')).toBeNull();
  });

  it('keeps a __proto__ attribute as plain data', () => {
    const root = parseXml('<a __proto__="x" polluted="y"/>');
    expect(Object.getPrototypeOf(root.attributes)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  const billionLaughs = `<!DOCTYPE lolz [<!ENTITY lol "lol">${Array.from(
    { length: 9 },
    (_item, index) =>
      `<!ENTITY lol${index + 1} "${`&lol${index || ''};`.repeat(10)}">`,
  ).join('')}]><lolz>&lol9;</lolz>`;
  it.each([
    [
      'a DOCTYPE with an external entity',
      '<!DOCTYPE problem [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><problem>&xxe;</problem>',
      'DOCTYPE',
    ],
    ['a billion-laughs DOCTYPE', billionLaughs, 'DOCTYPE'],
    [
      'an external DTD reference',
      '<!DOCTYPE problem SYSTEM "http://127.0.0.1/x.dtd"><problem/>',
      'DOCTYPE',
    ],
    ['an undefined entity', '<problem>&xxe;</problem>', 'not well-formed'],
    ['malformed markup', '<problem><a></problem>', 'not well-formed'],
    ['an unterminated CDATA', '<p><![CDATA[abc', 'not well-formed'],
    ['an unterminated comment', '<p><!-- abc', 'not well-formed'],
    ['trailing content', '<p/><q/>', 'not well-formed'],
    ['an empty document', '   ', 'not well-formed'],
  ])('rejects %s', (_label, xml, message) => {
    expect(() => parseXml(xml)).toThrow(XmlError);
    expect(() => parseXml(xml)).toThrow(message);
  });

  it('rejects nesting one level beyond the depth limit and accepts the limit itself', () => {
    const nested = (depth: number) =>
      `${'<a>'.repeat(depth)}${'</a>'.repeat(depth)}`;
    expect(() => parseXml(nested(XML_LIMITS.maxDepth))).not.toThrow();
    expect(() => parseXml(nested(XML_LIMITS.maxDepth + 1))).toThrow(
      new XmlError('problem.xml is nested too deep'),
    );
  });

  it('rejects one element above the cap and one byte above the size limit', () => {
    expect(() =>
      parseXml(`<p>${'<t/>'.repeat(XML_LIMITS.maxElements - 1)}</p>`),
    ).not.toThrow();
    expect(() =>
      parseXml(`<p>${'<t/>'.repeat(XML_LIMITS.maxElements)}</p>`),
    ).toThrow(new XmlError('problem.xml has too many elements'));
    const padding = XML_LIMITS.maxBytes + 1 - '<p></p>'.length;
    expect(() => parseXml(`<p>${'x'.repeat(padding)}</p>`)).toThrow(
      new XmlError(`problem.xml is larger than ${XML_LIMITS.maxBytes} bytes`),
    );
    expect(() => parseXml(`<p>${'x'.repeat(padding - 1)}</p>`)).not.toThrow();
  });

  it('stops at the first violation instead of parsing the rest of the file', () => {
    const tail = '<b/>'.repeat(400_000);
    const hostile = `${'<a>'.repeat(XML_LIMITS.maxDepth + 1)}${tail}`;
    const valid = `<a>${tail}</a>`;
    expect(() => parseXml(hostile)).toThrow('nested too deep');
    expect(timed(() => expect(() => parseXml(hostile)).toThrow())).toBeLessThan(
      timed(() => parseXml(valid)) / 2,
    );
  });

  it.each([
    ['a comment flood', (count: number) => `<p>${'<!---->'.repeat(count)}</p>`],
    [
      'one huge comment',
      (count: number) => `<p><!--${'x'.repeat(count * 7)}--></p>`,
    ],
    [
      'a CDATA flood',
      (count: number) => `<p>${'<![CDATA[x]]>'.repeat(count)}</p>`,
    ],
    [
      'one huge CDATA',
      (count: number) => `<p><![CDATA[${'x'.repeat(count * 7)}]]></p>`,
    ],
  ])('parses %s in time proportional to its size', (_label, build) => {
    const root = parseXml(build(SMALL));
    expect(root.name).toBe('p');
    expect(root.children).toEqual([]);
    const small = timed(() => parseXml(build(SMALL)));
    expect(timed(() => parseXml(build(FLOOD)))).toBeLessThan(
      (small * FLOOD * LINEAR_SLACK) / SMALL,
    );
  });

  it('parses 100000 test elements at a cost proportional to 10000', () => {
    parseXml(testElements(SMALL));
    const small = timed(() => parseXml(testElements(SMALL)));
    let root = null as ReturnType<typeof parseXml> | null;
    const large = timed(() => (root = parseXml(testElements(LARGE))));
    expect(large).toBeLessThan(small * LINEAR_RATIO_CAP);
    expect(descendants(root!, 'test')).toHaveLength(LARGE);
  });
});
