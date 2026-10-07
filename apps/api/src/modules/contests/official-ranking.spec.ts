import { CsvRankingError, parseOfficialRanking } from './official-ranking';

const csv = (lines: string[]) => lines.join('\r\n');

describe('parseOfficialRanking', () => {
  it('reads problems from column 4 on, empty scores as 0, sorted by points', () => {
    expect(
      parseOfficialRanking(
        csv([
          'Username,Full Name,School,Points,A,B',
          'ann,Ann,X,50,50,',
          'bob,"Bob, Jr.",Y,150,100,50',
        ]),
      ),
    ).toEqual({
      problems: ['A', 'B'],
      rows: [
        {
          username: 'bob',
          fullName: 'Bob, Jr.',
          scores: [100, 50],
          totalScore: 150,
        },
        { username: 'ann', fullName: 'Ann', scores: [50, 0], totalScore: 50 },
      ],
    });
  });

  it('starts problems at column 5 with a Team column and keeps ties in file order', () => {
    const parsed = parseOfficialRanking(
      csv([
        'Username,Full Name,Team,School,Points,P1',
        'c,C,T,S,10,10',
        'd,D,T,S,10,10',
      ]),
    );
    expect(parsed.problems).toEqual(['P1']);
    expect(parsed.rows.map((row) => row.username)).toEqual(['c', 'd']);
  });

  it('handles quotes, escaped quotes, LF endings, a BOM, blank lines and a trailing newline', () => {
    const parsed = parseOfficialRanking(
      String.fromCharCode(0xfeff) +
        'Username,Full Name,X,Points\n\n"e","E ""the"" best",x,1.5e1\n',
    );
    expect(parsed.rows).toEqual([
      { username: 'e', fullName: 'E "the" best', scores: [], totalScore: 15 },
    ]);
  });

  it('refuses a newline inside a quoted field as a control character', () => {
    expect(() =>
      parseOfficialRanking('Username,Full Name,X,Points\n"f","F\nG",x,1\n'),
    ).toThrow(/control character/);
  });

  it('trims whitespace around numbers and reads blank scores as 0', () => {
    const parsed = parseOfficialRanking(
      'Username,Full Name,X,Points,A\nh,H,x, 12.5 ,   \n',
    );
    expect(parsed.rows).toEqual([
      { username: 'h', fullName: 'H', scores: [0], totalScore: 12.5 },
    ]);
  });

  it.each([
    ['a missing Points column', 'Username,Full Name,X,Score\na,A,x,1'],
    ['a ragged row', 'Username,Full Name,X,Points,A\na,A,x,1'],
    ['an extra field', 'Username,Full Name,X,Points\na,A,x,1,2'],
    ['a non-finite number', 'Username,Full Name,X,Points\na,A,x,nan'],
    ['an infinite number', 'Username,Full Name,X,Points\na,A,x,inf'],
    ['a hex number', 'Username,Full Name,X,Points\na,A,x,0x10'],
    ['an overflowing number', 'Username,Full Name,X,Points\na,A,x,1e999'],
    ['an empty total', 'Username,Full Name,X,Points\na,A,x,'],
    ['an unterminated quote', 'Username,Full Name,X,Points\n"a,A,x,1'],
    ['a control character', 'Username,Full Name,X,Points\na\u0007,A,x,1'],
    [
      'an over-long field',
      `Username,Full Name,X,Points\n${'a'.repeat(201)},A,x,1`,
    ],
    ['an empty file', ''],
    [
      'a control character in the header',
      'Username,Full Name,X,Points,P\u0007\na,A,x,1,1',
    ],
    ['a CR-only file', 'Username,Full Name,X,Points\ra,A,x,1'],
  ])('rejects %s', (_case, text) => {
    expect(() => parseOfficialRanking(text)).toThrow(CsvRankingError);
  });

  it('bounds rows, columns and size', () => {
    const header = [
      'Username',
      'Full Name',
      'X',
      'Points',
      ...Array.from({ length: 102 }, (_unused, index) => `P${index}`),
    ].join(',');
    expect(() => parseOfficialRanking(header)).toThrow(/columns/);
    const rows = Array.from(
      { length: 10_001 },
      (_unused, index) => `u${index},U,x,1`,
    );
    expect(() =>
      parseOfficialRanking(csv(['Username,Full Name,X,Points', ...rows])),
    ).toThrow(/rows/);
    expect(
      parseOfficialRanking(
        csv(['Username,Full Name,X,Points', ...rows.slice(1)]),
      ).rows,
    ).toHaveLength(10_000);
    expect(() => parseOfficialRanking('x'.repeat(1_048_577))).toThrow(
      CsvRankingError,
    );
  });
});
