import { CsvError, csvCell, readCsv, writeCsv } from './csv';

const LIMITS = { rows: 3, columns: 4, fieldLength: 10 };

describe('csvCell', () => {
  it.each([
    ['plain', 'plain'],
    [12, '12'],
    [-3, '-3'],
    [true, 'true'],
    [null, ''],
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['two\nlines', '"two\nlines"'],
    ['a=b', 'a=b'],
    ['=SUM(A1)', "'=SUM(A1)"],
    ['+1', "'+1"],
    ['-1+2', "'-1+2"],
    ['@cmd', "'@cmd"],
    ['\tx', "'\tx"],
    [' =1', "' =1"],
    ['\n=1', `"'\n=1"`],
    ['\r=1', `"'\r=1"`],
  ])('writes %j as %j', (value, text) => expect(csvCell(value)).toBe(text));
});

describe('writeCsv', () => {
  it('ends every line with CRLF and starts with the mark when asked', () => {
    expect(writeCsv([['a', 1], ['b,c']])).toBe('a,1\r\n"b,c"\r\n');
    expect(writeCsv([['a']], { bom: true })).toBe('﻿a\r\n');
  });
});

describe('readCsv', () => {
  it('reads quoted fields with commas, doubled quotes and newlines', () => {
    expect(readCsv('a,"b,""c""",d\r\n"x\ny",,z\n', LIMITS)).toEqual([
      ['a', 'b,"c"', 'd'],
      ['x\ny', '', 'z'],
    ]);
  });

  it('drops a leading byte order mark and skips blank lines', () => {
    expect(readCsv('﻿a,b\n\nc,d', LIMITS)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('reads back what writeCsv wrote', () => {
    const rows = [
      ['a,b', 'say "hi"'],
      ['two\nlines', '=x'],
    ];
    expect(
      readCsv(writeCsv(rows, { bom: true }), { ...LIMITS, fieldLength: 50 }),
    ).toEqual([
      ['a,b', 'say "hi"'],
      ['two\nlines', "'=x"],
    ]);
  });

  it.each([
    ['a,"b', 'Unterminated quoted field'],
    ['a,b,c,d,e', 'More than 4 columns'],
    ['a\nb\nc\nd\ne', 'More than 3 rows'],
    ['a,bbbbbbbbbbb', 'A field is longer than 10 characters'],
  ])('refuses %j', (text, message) =>
    expect(() => readCsv(text, LIMITS)).toThrow(new CsvError(message)),
  );
});
