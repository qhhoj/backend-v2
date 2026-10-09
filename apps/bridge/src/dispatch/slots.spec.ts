import { newId } from '@libs/database';
import {
  canJudge,
  freeSlots,
  insertQueued,
  loadOf,
  nextFor,
  pickJudge,
  windingKey,
} from './slots';
import type { JudgeState, QueuedSubmission } from './slots';

const busyWith = (count: number): Map<string, number> =>
  new Map(Array.from({ length: count }, () => [newId(), 1]));
const judge = (name: string, extra: Partial<JudgeState> = {}): JudgeState => ({
  name,
  executors: new Set(['CPP17']),
  isDisabled: false,
  isDraining: false,
  slots: 1,
  inFlight: new Map(),
  winding: new Set(),
  ...extra,
});
const queued = (extra: Partial<QueuedSubmission> = {}): QueuedSubmission => ({
  id: newId(),
  problemCode: 'sum',
  languageKey: 'CPP17',
  priority: 1,
  generation: 0,
  judgeName: null,
  bannedJudges: [],
  retryBannedJudges: [],
  ...extra,
});

describe('slots', () => {
  it('counts free slots, none while draining, and the busy share as load', () => {
    const half = judge('a', { slots: 4, inFlight: busyWith(2) });
    expect(freeSlots(half)).toBe(2);
    expect(loadOf(half)).toBe(0.5);
    expect(freeSlots({ ...half, isDraining: true })).toBe(0);
    expect(freeSlots(judge('b', { slots: 1, inFlight: busyWith(3) }))).toBe(0);
  });
  it('counts a winding run against free slots until its Final', () => {
    const ref = { submissionId: newId(), generation: 3 };
    const winding = judge('a', {
      slots: 2,
      winding: new Set([windingKey(ref)]),
    });
    expect(windingKey(ref)).toBe(`${ref.submissionId}.3`);
    expect(freeSlots(winding)).toBe(1);
    expect(loadOf(winding)).toBe(0.5);
    winding.inFlight.set(newId(), 1);
    expect(freeSlots(winding)).toBe(0);
    expect(pickJudge([winding], queued())).toBeNull();
    winding.winding.delete(windingKey(ref));
    expect(freeSlots(winding)).toBe(1);
  });
});

describe('canJudge', () => {
  it('needs the language, whatever the problem (every judge sees the whole data root)', () => {
    expect(canJudge(judge('a'), queued({ problemCode: 'anything' }))).toBe(
      true,
    );
    expect(canJudge(judge('a'), queued({ languageKey: 'PY3' }))).toBe(false);
  });
  it('skips banned, retry-banned and disabled judges unless the submission asks for that judge by name', () => {
    expect(canJudge(judge('a'), queued({ bannedJudges: ['a'] }))).toBe(false);
    expect(canJudge(judge('a'), queued({ retryBannedJudges: ['a'] }))).toBe(
      false,
    );
    expect(canJudge(judge('a', { isDisabled: true }), queued())).toBe(false);
    expect(
      canJudge(judge('a', { isDisabled: true }), queued({ judgeName: 'a' })),
    ).toBe(true);
    expect(canJudge(judge('a'), queued({ judgeName: 'b' }))).toBe(false);
  });
});

describe('pickJudge', () => {
  it('picks the capable judge with a free slot and the lowest busy share', () => {
    const judges = [
      judge('full', { slots: 2, inFlight: busyWith(2) }),
      judge('half', { slots: 2, inFlight: busyWith(1) }),
      judge('quarter', { slots: 4, inFlight: busyWith(1) }),
      judge('incapable', { executors: new Set(['PY3']), slots: 8 }),
      judge('draining', { slots: 8, isDraining: true }),
    ];
    expect(pickJudge(judges, queued())?.name).toBe('quarter');
  });
  it('breaks load ties with the random source', () => {
    const judges = [judge('first'), judge('second'), judge('third')];
    expect(pickJudge(judges, queued(), () => 0)?.name).toBe('first');
    expect(pickJudge(judges, queued(), () => 0.99)?.name).toBe('third');
  });
  it('keeps the submission queued when every slot is taken', () =>
    expect(
      pickJudge([judge('a', { slots: 2, inFlight: busyWith(2) })], queued()),
    ).toBeNull());
  it('lets a rejudge take the last free slot only when the candidates have one slot in all', () => {
    const lastOfTwoJudges = [judge('a'), judge('b', { inFlight: busyWith(1) })];
    expect(pickJudge(lastOfTwoJudges, queued({ priority: 2 }))).toBeNull();
    expect(pickJudge(lastOfTwoJudges, queued({ priority: 1 }))?.name).toBe('a');
    const lastOfOneJudge = [judge('a', { slots: 2, inFlight: busyWith(1) })];
    expect(pickJudge(lastOfOneJudge, queued({ priority: 3 }))).toBeNull();
    expect(pickJudge([judge('a')], queued({ priority: 3 }))?.name).toBe('a');
    expect(
      pickJudge([judge('a', { slots: 2 })], queued({ priority: 3 })),
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
    const contest = queued({ priority: 0, languageKey: 'PY3' });
    const normal = queued({ priority: 1 });
    const rejudge = queued({ priority: 2 });
    for (const entry of [rejudge, normal, contest]) insertQueued(queue, entry);
    expect(nextFor(free, queue, [free])).toBe(normal);
  });
  it('holds a rejudge back from the last free slot while another slot could take it later', () => {
    const free = judge('a');
    const busy = judge('b', { inFlight: busyWith(1) });
    const rejudge = queued({ priority: 2 });
    expect(nextFor(free, [rejudge], [free, busy])).toBeNull();
    expect(nextFor(free, [rejudge], [free])).toBe(rejudge);
  });
  it('hold-back counts only capable candidates: incapable, disabled and draining judges never reserve', () => {
    const free = judge('a');
    const incapable = judge('b', { executors: new Set(['PY3']) });
    const disabled = judge('c', { isDisabled: true });
    const draining = judge('d', { isDraining: true, slots: 4 });
    const rejudge = queued({ priority: 3 });
    const judges = [free, incapable, disabled, draining];
    expect(nextFor(free, [rejudge], judges)).toBe(rejudge);
    expect(pickJudge(judges, rejudge)).toBe(free);
  });
  it('keeps scanning past a held-back rejudge to one no other judge could take', () => {
    const free = judge('a', { executors: new Set(['CPP17', 'PY3']) });
    const busy = judge('b', { inFlight: busyWith(1) });
    const held = queued({ priority: 2 });
    const later = queued({ priority: 2, languageKey: 'PY3' });
    const queue: QueuedSubmission[] = [];
    for (const entry of [held, later]) insertQueued(queue, entry);
    expect(nextFor(free, queue, [free, busy])).toBe(later);
  });
  it('holds a whole batch rejudge without rescanning the judges per entry', () => {
    let lookups = 0;
    const counting = new Set(['CPP17']);
    const originalHas = counting.has.bind(counting);
    counting.has = (value: string) => {
      lookups += 1;
      return originalHas(value);
    };
    const free = judge('a');
    const busy = Array.from({ length: 49 }, (_unused, index) =>
      judge(`busy${index}`, { inFlight: busyWith(1), executors: counting }),
    );
    const queue = Array.from({ length: 10000 }, () => queued({ priority: 2 }));
    expect(nextFor(free, queue, [free, ...busy])).toBeNull();
    expect(lookups).toBeLessThan(2 * busy.length);
  });
});
