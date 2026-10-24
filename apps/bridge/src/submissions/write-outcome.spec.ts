import { newId } from '@libs/database';
import { classifyMiss } from './write-outcome';
import type { RunKey, StoredRun } from './write-outcome';

const key: RunKey = {
  ref: { submissionId: newId(), generation: 3 },
  judgeName: 'j1',
  seq: 5,
};
const run = (fields: Partial<StoredRun> = {}): StoredRun => ({
  judgedOn: 'j1',
  judgeGeneration: 3,
  judgeSeq: 4,
  status: 'G',
  caseCount: 0,
  retryCount: 0,
  refusalCount: 0,
  deferralCount: 0,
  ...fields,
});
const grading = { statuses: ['G'] as const, addsCases: 0 };

describe('classifyMiss', () => {
  it('calls a vanished row, another judge or another generation stale', () => {
    expect(classifyMiss(key, null, grading)).toBe('stale');
    expect(classifyMiss(key, run({ judgedOn: 'j2' }), grading)).toBe('stale');
    expect(classifyMiss(key, run({ judgedOn: null }), grading)).toBe('stale');
    expect(classifyMiss(key, run({ judgeGeneration: 4 }), grading)).toBe(
      'stale',
    );
  });
  it('calls a seq already stored a duplicate, whatever the status', () => {
    expect(classifyMiss(key, run({ judgeSeq: 5 }), grading)).toBe('duplicate');
    expect(classifyMiss(key, run({ judgeSeq: 9, status: 'D' }), grading)).toBe(
      'duplicate',
    );
  });
  it('calls a seq that skips one a gap', () => {
    expect(classifyMiss(key, run({ judgeSeq: 3 }), grading)).toBe('gap');
  });
  it('calls the next seq out of order while the run is in flight, and stale once it ended', () => {
    expect(classifyMiss(key, run({ status: 'P' }), grading)).toBe('order');
    expect(classifyMiss(key, run({ status: 'D' }), grading)).toBe('stale');
    expect(classifyMiss(key, run({ status: 'AB' }), grading)).toBe('stale');
  });
  it('calls cases beyond 10000 full, and anything else a race to ignore', () => {
    const adding = { statuses: ['G'] as const, addsCases: 2 };
    expect(classifyMiss(key, run({ caseCount: 9999 }), adding)).toBe('full');
    expect(classifyMiss(key, run({ caseCount: 9998 }), adding)).toBe('stale');
  });
  it('calls a replay of a RETRY Final a duplicate once its row is back in the queue, until a rejudge or a new claim', () => {
    const retried = run({
      judgedOn: null,
      status: 'QU',
      judgeSeq: 5,
      retryCount: 1,
    });
    expect(classifyMiss(key, retried, grading)).toBe('duplicate');
    expect(classifyMiss({ ...key, seq: 6 }, retried, grading)).toBe('stale');
    expect(classifyMiss(key, { ...retried, retryCount: 0 }, grading)).toBe(
      'stale',
    );
    expect(classifyMiss(key, { ...retried, judgeSeq: 0 }, grading)).toBe(
      'stale',
    );
    expect(classifyMiss(key, { ...retried, judgeGeneration: 4 }, grading)).toBe(
      'stale',
    );
  });
});
