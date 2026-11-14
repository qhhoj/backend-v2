import type { SubmissionCase } from '@libs/database';
import { frozenCopyOf, isShareable } from './frozen-copy';
import type { CopySource } from './frozen-copy';

const SUBMISSION_ID = '019a0000-0000-7000-8000-000000000001';
const PROBLEM_ID = '019a0000-0000-7000-8000-000000000002';

const testCase = (position: number, batch: number | null): SubmissionCase => ({
  position,
  status: position === 1 ? 'AC' : 'WA',
  time: 0.5,
  memory: 1024,
  points: position === 1 ? 10 : 0,
  total: 10,
  batch,
  feedback: 'checker said: expected 42',
  extendedFeedback: 'jury answer 42',
  output: 'program printed 41',
});

const source = (
  submission: Partial<CopySource['submission']> = {},
  problem: Partial<CopySource['problem']> = {},
): CopySource => ({
  submission: {
    _id: SUBMISSION_ID,
    problem: PROBLEM_ID,
    contest: null,
    status: 'D',
    result: 'WA',
    error: 'warning: unused variable',
    points: 10,
    casePoints: 10,
    caseTotal: 20,
    time: 0.5,
    memory: 1024,
    date: new Date('2026-11-14T10:00:00Z'),
    judgedDate: new Date('2026-11-14T10:00:05Z'),
    cases: [testCase(1, 1), testCase(2, 1)],
    ...submission,
  },
  problem: {
    points: 100,
    testcaseResultVisibility: 'A',
    testcaseVisibility: 'A',
    allowViewFeedback: true,
    deletedAt: undefined,
    ...problem,
  },
  caseCount: 2,
});

describe('frozenCopyOf', () => {
  it('keeps case results but never checker feedback, program output or compiler warnings', () => {
    const copy = frozenCopyOf(source());
    expect(copy.cases).toEqual([
      {
        position: 1,
        status: 'AC',
        time: 0.5,
        memory: 1024,
        points: 10,
        total: 10,
        batch: 1,
      },
      {
        position: 2,
        status: 'WA',
        time: 0.5,
        memory: 1024,
        points: 0,
        total: 10,
        batch: 1,
      },
    ]);
    expect(JSON.stringify(copy)).not.toMatch(
      /checker said|jury answer|printed|warning/,
    );
    expect(copy).toMatchObject({
      problemPoints: 100,
      compileLog: null,
      caseCount: 2,
    });
  });

  it("follows the problem's case rule: batch summaries, totals only, nothing for a deleted problem", () => {
    expect(
      frozenCopyOf(source({}, { testcaseResultVisibility: 'B' })),
    ).toMatchObject({
      cases: null,
      batches: [{ batch: 1, status: 'WA', points: 0, total: 10 }],
    });
    for (const problem of [
      { testcaseResultVisibility: 'S' },
      { deletedAt: new Date() },
    ])
      expect(frozenCopyOf(source({}, problem))).toMatchObject({
        cases: null,
        batches: null,
        caseCount: null,
      });
  });

  it('keeps the compile log of a CE, and refuses internal errors and unfinished runs', () => {
    expect(
      frozenCopyOf(
        source({ status: 'CE', result: 'CE', error: 'main.cpp:1: error' }),
      ).compileLog,
    ).toBe('main.cpp:1: error');
    expect(isShareable({ status: 'D', result: 'WA' })).toBe(true);
    expect(isShareable({ status: 'IE', result: 'IE' })).toBe(false);
    expect(isShareable({ status: 'D', result: 'IE' })).toBe(false);
    expect(isShareable({ status: 'PD', result: null })).toBe(false);
    expect(isShareable({ status: 'G', result: null })).toBe(false);
  });
});
