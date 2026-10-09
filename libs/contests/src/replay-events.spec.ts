import type { FormatSetting } from './formats/registry';
import { at, context, row, T0 } from './formats/scoring-fixtures';
import { chunkEvents, mergeEvents, replayEvents } from './replay-events';
import type { ReplayEvent, ReplayTarget } from './replay-events';

const PROBLEMS = [
  { problemId: 'a', points: 100, dataPoints: 100 },
  { problemId: 'b', points: 100, dataPoints: 100 },
];
const target: ReplayTarget = {
  participantIndex: 3,
  problemIndexes: new Map([
    ['a', 0],
    ['b', 1],
  ]),
};
const batch = (points: number) => ({ batchPoints: { '0': points } });
const sample = () => [
  row('a', 5, 0, batch(0)),
  row('a', 12, 100, batch(100)),
  row('b', 20, 40, batch(40)),
  row('b', 30, 70, batch(70)),
];
const FORMATS = [
  'default',
  'ioi',
  'ioi16',
  'icpc',
  'vnoj',
  'ultimate',
] as const;

describe('replayEvents', () => {
  it.each(FORMATS)(
    '%s: one event per submission, each on its own problem, times in order',
    (name) => {
      const events = replayEvents(
        sample(),
        { name, config: {} },
        context({ problems: PROBLEMS }),
        target,
      );
      expect(events.map((event) => event[2])).toEqual([0, 0, 1, 1]);
      expect(events.map((event) => event[0])).toEqual([300, 720, 1200, 1800]);
    },
  );

  it('scores a lone solve at minute 12 as 100 points at 720 seconds in the default format', () => {
    const events = replayEvents(
      [row('a', 12, 100)],
      { name: 'default', config: {} },
      context({ problems: PROBLEMS }),
      target,
    );
    expect(events[0].slice(4)).toEqual([100, 720, 0]);
  });

  it('emits one event per submission, tagged with the participant and problem index, in time order', () => {
    const events = replayEvents(
      sample(),
      { name: 'default', config: {} },
      context({ problems: PROBLEMS }),
      target,
    );
    expect(events.map((event) => event.slice(0, 3))).toEqual([
      [300, 3, 0],
      [720, 3, 0],
      [1200, 3, 1],
      [1800, 3, 1],
    ]);
  });

  it("measures time from the participation start, not the contest start, and keeps ultimate's contest-start cumtime", () => {
    const windowed = context({
      start: at(10),
      contestStart: T0,
      problems: PROBLEMS,
    });
    const events = replayEvents(
      [row('a', 12, 100)],
      { name: 'ultimate', config: {} },
      windowed,
      target,
    );
    expect(events).toHaveLength(1);
    expect(events[0][0]).toBe(120);
    expect(events[0][5]).toBe(720);
  });

  it('emits one event with the final state for submissions to one problem at the same instant', () => {
    const rows = [row('a', 12, 0), row('a', 12, 100)];
    const events = replayEvents(
      rows,
      { name: 'default', config: {} },
      context({ problems: PROBLEMS }),
      target,
    );
    expect(events).toHaveLength(1);
    expect(events[0][4]).toBe(100);
  });

  it('ignores rows of problems outside the target and returns nothing for no rows', () => {
    const format: FormatSetting = { name: 'default', config: {} };
    expect(
      replayEvents([row('zzz', 3, 100)], format, context(), target),
    ).toEqual([]);
    expect(replayEvents([], format, context(), target)).toEqual([]);
  });
});

describe('mergeEvents', () => {
  const event = (
    seconds: number,
    participant: number,
    problem = 0,
  ): ReplayEvent => [seconds, participant, problem, {}, 0, 0, 0];

  it('orders by time, then participant, whatever the stream order', () => {
    const merged = mergeEvents([
      [event(30, 1), event(60, 1)],
      [event(10, 0), event(30, 0, 1)],
    ]);
    expect(merged.map((item) => item.slice(0, 3))).toEqual([
      [10, 0, 0],
      [30, 0, 1],
      [30, 1, 0],
      [60, 1, 0],
    ]);
  });

  it("keeps one participant's same-second events in submission order, even when the later one is on a lower problem", () => {
    const merged = mergeEvents([
      [event(30, 0, 2), event(30, 0, 1)],
      [event(30, 1, 0)],
    ]);
    expect(merged.map((item) => item.slice(0, 3))).toEqual([
      [30, 0, 2],
      [30, 0, 1],
      [30, 1, 0],
    ]);
  });
});

describe('chunkEvents', () => {
  const events = Array.from(
    { length: 12_001 },
    (_unused, index): ReplayEvent => [index, 0, 0, {}, 0, 0, 0],
  );

  it('splits at 5000 events and loses none: the chunks concatenate to the input', () => {
    const chunks = chunkEvents(events);
    expect(chunks.map((chunk) => chunk.length)).toEqual([5000, 5000, 2001]);
    expect(chunks.flat()).toEqual(events);
  });

  it('gives no chunk for no events', () => expect(chunkEvents([])).toEqual([]));
});
