import { newId } from '@libs/database';
import { canJudge, insertQueued, nextFor, pickJudge } from './dispatch';
import type { JudgeState, QueuedSubmission } from './dispatch';

const judge = (name: string, extra: Partial<JudgeState> = {}): JudgeState => ({
  name,
  problems: new Set(['sum']),
  executors: new Set(['CPP17']),
  isDisabled: false,
  load: 0,
  workingOn: null,
  ...extra,
});
const queued = (extra: Partial<QueuedSubmission> = {}): QueuedSubmission => ({
  id: newId(),
  problemCode: 'sum',
  languageKey: 'CPP17',
  priority: 1,
  judgeName: null,
  bannedJudges: [],
  ...extra,
});

describe('canJudge', () => {
  it('needs the problem and the executor', () => {
    expect(canJudge(judge('a'), queued())).toBe(true);
    expect(canJudge(judge('a'), queued({ problemCode: 'mul' }))).toBe(false);
    expect(canJudge(judge('a'), queued({ languageKey: 'PY3' }))).toBe(false);
  });
  it('skips banned and disabled judges unless the submission asks for that judge by name', () => {
    expect(canJudge(judge('a'), queued({ bannedJudges: ['a'] }))).toBe(false);
    expect(canJudge(judge('a', { isDisabled: true }), queued())).toBe(false);
    expect(
      canJudge(judge('a', { isDisabled: true }), queued({ judgeName: 'a' })),
    ).toBe(true);
    expect(canJudge(judge('a'), queued({ judgeName: 'b' }))).toBe(false);
  });
});

describe('pickJudge', () => {
  it('picks the free candidate with the lowest load', () => {
    const judges = [
      judge('busy', { load: 0, workingOn: newId() }),
      judge('heavy', { load: 0.9 }),
      judge('light', { load: 0.2 }),
      judge('incapable', { load: 0, problems: new Set() }),
    ];
    expect(pickJudge(judges, queued())?.name).toBe('light');
  });
  it('breaks load ties with the random source', () => {
    const judges = [judge('first'), judge('second'), judge('third')];
    expect(pickJudge(judges, queued(), () => 0)?.name).toBe('first');
    expect(pickJudge(judges, queued(), () => 0.99)?.name).toBe('third');
  });
  it('keeps the submission queued when every candidate is busy', () =>
    expect(
      pickJudge([judge('a', { workingOn: newId() })], queued()),
    ).toBeNull());
  it('lets a rejudge take the last free candidate only when no other judge could take it', () => {
    const oneFreeOfTwo = [judge('a'), judge('b', { workingOn: newId() })];
    expect(pickJudge(oneFreeOfTwo, queued({ priority: 2 }))).toBeNull();
    expect(pickJudge(oneFreeOfTwo, queued({ priority: 3 }))).toBeNull();
    expect(pickJudge(oneFreeOfTwo, queued({ priority: 1 }))?.name).toBe('a');
    expect(pickJudge([judge('a')], queued({ priority: 3 }))?.name).toBe('a');
    expect(
      pickJudge([judge('a'), judge('b')], queued({ priority: 3 })),
    ).not.toBeNull();
  });
});

describe('insertQueued', () => {
  it('orders by priority, then by id (oldest first), whatever the insertion order', () => {
    const entries = Array.from({ length: 300 }, (_unused, index) =>
      queued({ priority: (index * 7) % 4 }),
    );
    const shuffled = [
      ...entries.filter((_entry, index) => index % 2 === 1).reverse(),
      ...entries.filter((_entry, index) => index % 2 === 0),
    ];
    const queue: QueuedSubmission[] = [];
    for (const entry of shuffled) insertQueued(queue, entry);
    expect(queue).toHaveLength(entries.length);
    for (let index = 1; index < queue.length; index += 1) {
      const [before, after] = [queue[index - 1], queue[index]];
      expect(
        before.priority < after.priority ||
          (before.priority === after.priority && before.id < after.id),
      ).toBe(true);
    }
  });
});

describe('nextFor', () => {
  it('serves the highest priority it can judge, skipping what it cannot', () => {
    const free = judge('a');
    const queue: QueuedSubmission[] = [];
    const contest = queued({ priority: 0, problemCode: 'mul' });
    const normal = queued({ priority: 1 });
    const rejudge = queued({ priority: 2 });
    for (const entry of [rejudge, normal, contest]) insertQueued(queue, entry);
    expect(nextFor(free, queue, [free])).toBe(normal);
  });
  it('holds a rejudge back from the last free judge while another could take it', () => {
    const free = judge('a');
    const busy = judge('b', { workingOn: newId() });
    const rejudge = queued({ priority: 2 });
    expect(nextFor(free, [rejudge], [free, busy])).toBeNull();
    expect(nextFor(free, [rejudge], [free])).toBe(rejudge);
  });
});
