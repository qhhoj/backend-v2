import { buildZip } from '../testing';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  linkTokenOfPackage,
  linkTokenOfProblemXml,
} from './polygon-package-token';
import { parsePolygonLink } from './polygon-problem-link';

const LINK =
  'https://polygon.codeforces.com/p3n21nw/LamTerQH/qhh-evolution-ioi';

describe('parsePolygonLink', () => {
  it('reads the token, owner and name of a problem page address', () => {
    const parts = {
      token: 'p3n21nw',
      owner: 'LamTerQH',
      name: 'qhh-evolution-ioi',
    };
    expect(parsePolygonLink(LINK)).toEqual(parts);
    expect(parsePolygonLink(`  ${LINK}/\n`)).toEqual(parts);
    expect(parsePolygonLink(`${LINK}?ccid=abc#tests`)).toEqual(parts);
    expect(
      parsePolygonLink(
        'https://POLYGON.codeforces.com/p85dIBF/a.b_c-d/a-plus-b',
      ),
    ).toEqual({ token: 'p85dIBF', owner: 'a.b_c-d', name: 'a-plus-b' });
  });

  it.each([
    ['plain http', LINK.replace('https:', 'http:')],
    [
      'another host',
      LINK.replace('polygon.codeforces.com', 'polygon.codeforces.ru'),
    ],
    [
      'a look-alike host',
      LINK.replace('polygon.codeforces.com', 'polygon.codeforces.com.evil.io'),
    ],
    ['a port', LINK.replace('.com/', '.com:8443/')],
    ['credentials', LINK.replace('https://', 'https://user:pw@')],
    ['no token', 'https://polygon.codeforces.com/LamTerQH/qhh-evolution-ioi'],
    ['a short token', LINK.replace('p3n21nw', 'p3n21n')],
    ['a token not starting with p', LINK.replace('p3n21nw', 'x3n21nw')],
    ['an extra segment', `${LINK}/tests`],
    ['an upper-case problem name', LINK.replace('qhh-evolution-ioi', 'QHH')],
    ['an encoded character', LINK.replace('LamTerQH', 'Lam%2FTer')],
    ['the API address', 'https://polygon.codeforces.com/api/problems.list'],
    ['not a URL', 'p3n21nw/LamTerQH/qhh-evolution-ioi'],
    ['an overlong text', `${LINK}?${'x'.repeat(400)}`],
  ])('refuses %s', (_case, text) => {
    expect(parsePolygonLink(text)).toBeNull();
  });
});

describe('linkTokenOfProblemXml', () => {
  it('reads the token problem.xml records in <problem url>', () => {
    expect(
      linkTokenOfProblemXml(
        `<?xml version="1.0"?><problem revision="3" short-name="qhh-evolution-ioi" url="${LINK}"><names/></problem>`,
      ),
    ).toBe('p3n21nw');
  });

  it('has no token without a url, with a url that is not a problem link, or on another root', () => {
    expect(linkTokenOfProblemXml('<problem revision="3"/>')).toBeNull();
    expect(
      linkTokenOfProblemXml('<problem url="https://example.com/p3n21nw/a/b"/>'),
    ).toBeNull();
    expect(linkTokenOfProblemXml(`<contest url="${LINK}"/>`)).toBeNull();
  });
});

describe('linkTokenOfPackage', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'polygon-token-'));
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  const packageWith = (entries: Parameters<typeof buildZip>[0]) => {
    const path = join(directory, 'package.zip');
    writeFileSync(path, buildZip(entries));
    return path;
  };

  it('reads the token from the root problem.xml only', async () => {
    expect(
      await linkTokenOfPackage(
        packageWith([
          { name: 'statements/problem.xml', content: '<problem/>' },
          { name: 'problem.xml', content: `<problem url="${LINK}"/>` },
        ]),
      ),
    ).toBe('p3n21nw');
    expect(
      await linkTokenOfPackage(
        packageWith([
          { name: 'files/problem.xml', content: `<problem url="${LINK}"/>` },
        ]),
      ),
    ).toBeNull();
  });
});
