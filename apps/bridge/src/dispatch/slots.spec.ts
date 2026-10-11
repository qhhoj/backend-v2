import { newId } from '@libs/database';
import { COMPILE_FEATURE, GENERATE_FEATURE } from '@libs/judging';
import {
  canJudge,
  freeSlots,
  insertQueued,
  loadOf,
  mayStartGeneration,
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
  features: new Set(),
  generations: new Set(),
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
  it('counts a winding slot as opening for the hold-back: a rejudge takes the spare slot beside it, not the last one', () => {
    const windingOne = judge('a', {
      slots: 2,
      winding: new Set([windingKey({ submissionId: newId(), generation: 1 })]),
    });
    expect(pickJudge([windingOne], queued({ priority: 2 }))).toBe(windingOne);
    const liveOne = judge('a', { slots: 2, inFlight: busyWith(1) });
    expect(pickJudge([liveOne], queued({ priority: 2 }))).toBeNull();
    const windingTwo = judge('a', {
      slots: 3,
      inFlight: busyWith(1),
      winding: new Set(['x.1']),
    });
    expect(pickJudge([windingTwo], queued({ priority: 2 }))).toBe(windingTwo);
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
});

describe('generations in the slot count', () => {
  const capable = (extra: Partial<JudgeState> = {}) =>
    judge('gen', { features: new Set([GENERATE_FEATURE]), ...extra });
  const holding = (count: number) =>
    new Set(Array.from({ length: count }, () => newId()));

  it('a held generation takes a slot', () => {
    const busy = capable({ slots: 2, generations: holding(1) });
    expect(freeSlots(busy)).toBe(1);
    expect(loadOf(busy)).toBe(0.5);
  });

  it.each([
    ['4 free of 4', { slots: 4 }, false, true],
    ['2 free of 4', { slots: 4, inFlight: busyWith(2) }, false, true],
    [
      'its last free slot of 4',
      { slots: 4, inFlight: busyWith(3) },
      false,
      false,
    ],
    [
      'the third slot after two generations',
      { slots: 4, generations: holding(2) },
      false,
      true,
    ],
    [
      'the last slot after three generations',
      { slots: 4, generations: holding(3) },
      false,
      false,
    ],
    ['the only slot of a 1-slot judge', { slots: 1 }, false, true],
    ['a 1-slot judge with a waiting submission', { slots: 1 }, true, false],
    ['a 4-slot judge with a waiting submission', { slots: 4 }, true, false],
    ['no free slot', { slots: 1, inFlight: busyWith(1) }, false, false],
    ['a disabled judge', { slots: 4, isDisabled: true }, false, false],
    ['a draining judge', { slots: 4, isDraining: true }, false, false],
    [
      'a judge with compile checks only',
      { slots: 4, features: new Set([COMPILE_FEATURE]) },
      false,
      true,
    ],
    [
      'a judge without the feature',
      { slots: 4, features: new Set<string>() },
      false,
      false,
    ],
  ])('offers %s: %s', (_name, extra, isWaiting, expected) => {
    expect(mayStartGeneration(capable(extra), isWaiting)).toBe(expected);
  });
});
