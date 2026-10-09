import { newId } from '@libs/database';
import { GraceRegistry } from './grace';
import type { GraceEntry } from './grace';

describe('GraceRegistry', () => {
  const expired: GraceEntry[] = [];
  let grace: GraceRegistry;
  beforeEach(() => {
    jest.useFakeTimers();
    expired.length = 0;
    grace = new GraceRegistry(30_000, (entry) => expired.push(entry));
  });
  afterEach(() => {
    grace.clear();
    jest.useRealTimers();
  });

  it('expires a held run once, after the grace, with whether the api aborted it meanwhile', () => {
    const ref = { submissionId: newId(), generation: 2 };
    grace.hold(ref, 'j1');
    expect(grace.requestAbort(ref.submissionId)).toBe(true);
    jest.advanceTimersByTime(29_999);
    expect(expired).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(expired).toEqual([{ ref, judgeName: 'j1', abortRequested: true }]);
    jest.advanceTimersByTime(60_000);
    expect(expired).toHaveLength(1);
    expect(grace.ids()).toEqual([]);
  });

  it('holds a run with an abort given at hold time, and a re-hold of the same generation keeps an earlier abort', () => {
    const ref = { submissionId: newId(), generation: 2 };
    grace.hold(ref, 'j1', true);
    grace.hold(ref, 'j1');
    const newer = { submissionId: newId(), generation: 1 };
    grace.hold(newer, 'j1', true);
    grace.hold({ ...newer, generation: 2 }, 'j1');
    jest.advanceTimersByTime(30_000);
    expect(expired).toEqual([
      { ref, judgeName: 'j1', abortRequested: true },
      {
        ref: { ...newer, generation: 2 },
        judgeName: 'j1',
        abortRequested: false,
      },
    ]);
  });

  it('hands a run back only to the same judge and generation, and then never expires it', () => {
    const ref = { submissionId: newId(), generation: 3 };
    grace.hold(ref, 'j1');
    expect(grace.take(ref, 'j2')).toBeUndefined();
    expect(grace.take({ ...ref, generation: 2 }, 'j1')).toBeUndefined();
    expect(grace.take(ref, 'j1')).toEqual({
      ref,
      judgeName: 'j1',
      abortRequested: false,
    });
    jest.advanceTimersByTime(60_000);
    expect(expired).toEqual([]);
  });

  it('drops a run made void by a rejudge, but not a newer generation', () => {
    const old = { submissionId: newId(), generation: 1 };
    const newer = { submissionId: newId(), generation: 5 };
    grace.hold(old, 'j1');
    grace.hold(newer, 'j1');
    grace.discard(old.submissionId, 1);
    grace.discard(newer.submissionId, 4);
    expect(grace.ids()).toEqual([newer.submissionId]);
    jest.advanceTimersByTime(30_000);
    expect(expired.map((entry) => entry.ref)).toEqual([newer]);
  });

  it('expires at once what a reconnected judge no longer lists, lists entries by judge, and stops every timer on clear', () => {
    const first = { submissionId: newId(), generation: 1 };
    const second = { submissionId: newId(), generation: 1 };
    grace.hold(first, 'j1');
    grace.hold(second, 'j2');
    expect(grace.of('j1').map((entry) => entry.ref)).toEqual([first]);
    grace.expireNow(first.submissionId);
    expect(expired.map((entry) => entry.ref)).toEqual([first]);
    grace.clear();
    jest.advanceTimersByTime(60_000);
    expect(expired).toHaveLength(1);
    expect(grace.requestAbort(second.submissionId)).toBe(false);
  });
});
