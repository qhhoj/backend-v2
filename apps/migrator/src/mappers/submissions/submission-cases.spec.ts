import { MapCtx } from '../../mapper';
import { casesOf, CaseRow } from './submission-cases';

const report = jest.fn();
const ctx = { report } as unknown as MapCtx;
const row = (fields: Partial<CaseRow>): CaseRow => ({
  id: 1,
  submission_id: 1,
  case: 1,
  status: 'AC',
  time: 0.1,
  memory: 10,
  points: 1,
  total: 1,
  batch: null,
  feedback: '',
  extended_feedback: '',
  output: '',
  ...fields,
});

describe('casesOf', () => {
  it('sorts by case, clips text and drops unknown statuses', () => {
    const cases = casesOf(
      [
        row({ id: 3, case: 2, status: 'WA' }),
        row({ id: 2, case: 1, output: 'é'.repeat(300) }),
        row({ id: 4, case: 3, status: 'ZZ' }),
        row({ id: 5, case: 4, status: 'RJ' }),
      ],
      ctx,
      'judge_submission:1',
    );
    expect(
      cases.map((testCase) => [testCase.position, testCase.status]),
    ).toEqual([
      [1, 'AC'],
      [2, 'WA'],
    ]);
    expect(Buffer.byteLength(cases[0].output)).toBeLessThanOrEqual(512);
    expect(report).toHaveBeenCalledWith(
      'judge_submission:1 case status "ZZ" dropped',
    );
    expect(report).toHaveBeenCalledWith(
      'judge_submission:1 case status "RJ" dropped',
    );
  });

  it('keeps at most 10000 cases and reports the rest', () => {
    const rows = Array.from({ length: 10_002 }, (unused, index) =>
      row({ id: index + 1, case: index + 1 }),
    );
    expect(casesOf(rows, ctx, 'judge_submission:2')).toHaveLength(10_000);
    expect(report).toHaveBeenCalledWith(
      'judge_submission:2 2 case(s) over 10000 dropped',
    );
  });
});
