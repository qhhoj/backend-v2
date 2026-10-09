import { csvCell, exportCsv } from './export-csv';
import type { ExportRow } from './export-csv';

const row = (extra: Partial<ExportRow> = {}): ExportRow => ({
  submissionId: 's1',
  participationId: 'p1',
  username: 'ann',
  problem: 'sum',
  language: 'C++',
  submittedAt: new Date('2026-03-01T09:10:00.000Z'),
  contestSeconds: 600.5,
  status: 'D',
  result: 'AC',
  points: 100,
  isDisqualified: false,
  extension: 'cpp',
  ...extra,
});

describe('csvCell', () => {
  it.each([
    ['plain', 'plain'],
    [12, '12'],
    [true, 'true'],
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['two\nlines', '"two\nlines"'],
    ['=SUM(A1)', "'=SUM(A1)"],
    ['+1', "'+1"],
    ['-1+2', "'-1+2"],
    ['@cmd', "'@cmd"],
    ['\tx', "'\tx"],
    ['a=b', 'a=b'],
  ])('writes %j as %j', (value, text) => expect(csvCell(value)).toBe(text));

  it('keeps a negative number a number', () => expect(csvCell(-3)).toBe('-3'));
});

describe('exportCsv', () => {
  it('writes a header and one line per row, CRLF terminated', () => {
    const csv = exportCsv([
      row(),
      row({
        submissionId: 's2',
        result: null,
        points: 0,
        isDisqualified: true,
      }),
    ]);
    expect(csv.split('\r\n')).toEqual([
      'submission_id,participation_id,username,problem,language,submitted_at,contest_seconds,status,result,points,disqualified',
      's1,p1,ann,sum,C++,2026-03-01T09:10:00.000Z,600.5,D,AC,100,false',
      's2,p1,ann,sum,C++,2026-03-01T09:10:00.000Z,600.5,D,,0,true',
      '',
    ]);
  });

  it('writes only the header for no rows', () =>
    expect(exportCsv([]).split('\r\n')).toHaveLength(2));

  it('cannot turn a hostile username into a spreadsheet formula', () => {
    const line = exportCsv([row({ username: '=HYPERLINK("http://x")' })]).split(
      '\r\n',
    )[1];
    expect(line).toContain(`"'=HYPERLINK(""http://x"")"`);
  });
});
