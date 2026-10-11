import { scoreParticipation } from './formats/registry';
import { context, row, T0 } from './formats/scoring-fixtures';
import { ghostReplay, ghostReplays } from './ghost-replay';
import type { GhostSetup } from './ghost-replay';
import type { GhostCell, GhostInput } from './ghost-types';

const setup = (extra: Partial<GhostSetup> = {}): GhostSetup => ({
  format: { name: 'icpc', config: {} },
  startTime: T0,
  pointsPrecision: 3,
  problems: [
    { problemId: 'a', points: 100 },
    { problemId: 'b', points: 100 },
  ],
  ...extra,
});
const ghost = (cells: Partial<GhostCell>[]): GhostInput => ({
  label: 'Ann',
  caption: '',
  cells: cells.map((cell) => ({
    problemId: 'a',
    minute: 12,
    rejectedBefore: null,
    points: null,
    ...cell,
  })),
});

describe('ghostReplay', () => {
  it('ranks an ICPC ghost with the same score, penalty and tiebreaker as a real row with the same tries', () => {
    const replay = ghostReplay(
      ghost([{ minute: 12, rejectedBefore: 2 }]),
      4,
      setup(),
    );
    const real = scoreParticipation(
      [row('a', 3, 0), row('a', 5, 0), row('a', 12, 100)],
      { name: 'icpc', config: {} },
      context({
        problems: [{ problemId: 'a', points: 100, dataPoints: null }],
      }),
    );
    expect(replay.isUnranked).toBe(false);
    expect(replay.events).toHaveLength(1);
    expect(replay.events[0].slice(0, 3)).toEqual([720, 4, 0]);
    expect(replay.events[0].slice(4)).toEqual([
      real.score,
      real.cumtime,
      real.tiebreaker,
    ]);
  });

  it('puts a later solve after an earlier one and accumulates the totals', () => {
    const replay = ghostReplay(
      ghost([
        { minute: 30, rejectedBefore: 0 },
        { problemId: 'b', minute: 10, rejectedBefore: 1 },
      ]),
      0,
      setup(),
    );
    expect(replay.events.map((event) => event[0])).toEqual([600, 1800]);
    expect(replay.events.at(-1)!.slice(4)).toEqual([200, 10 + 20 + 30, 30]);
  });

  it('marks a ghost unranked, with the gap and no events, when the format needs data the source lacks', () => {
    const noTries = ghostReplay(ghost([{ minute: 12 }]), 0, setup());
    expect(noTries).toMatchObject({
      isUnranked: true,
      gap: 'rejectedBefore',
      events: [],
    });
    const noPoints = ghostReplay(
      ghost([{ minute: 12 }]),
      0,
      setup({ format: { name: 'ioi', config: {} } }),
    );
    expect(noPoints).toMatchObject({
      isUnranked: true,
      gap: 'points',
      events: [],
    });
  });

  it('skips cells of problems the contest no longer has', () => {
    const replay = ghostReplay(
      ghost([
        { problemId: 'gone', minute: 5, rejectedBefore: 0 },
        { minute: 9, rejectedBefore: 0 },
      ]),
      0,
      setup(),
    );
    expect(replay.events).toHaveLength(1);
    expect(replay.events[0][2]).toBe(0);
  });

  it('emits one event per solved cell even when two cells share a minute (no interleaving of their tries)', () => {
    const replay = ghostReplay(
      ghost([
        { minute: 10, rejectedBefore: 2 },
        { problemId: 'b', minute: 10, rejectedBefore: 1 },
      ]),
      0,
      setup(),
    );
    expect(replay.events.map((event) => event[2])).toEqual([0, 1]);
    expect(replay.events.at(-1)!.slice(4)).toEqual([200, 10 + 10 + 60, 10]);
  });

  it("caps a ghost's points at the problem's points so a typo cannot inflate the board", () => {
    const replay = ghostReplay(
      ghost([{ minute: 20, points: 99999 }]),
      0,
      setup({ format: { name: 'ioi', config: {} } }),
    );
    expect(replay.events[0][4]).toBe(100);
  });
});

describe('ghostReplays', () => {
  const named = (label: string, cell: Partial<GhostCell>): GhostInput => ({
    ...ghost([cell]),
    label,
  });

  it('lists ranked ghosts first, then unranked, each by label, and numbers the events by that position', () => {
    const replays = ghostReplays(
      [
        named('Ann', { minute: 5 }),
        named('Zed', { minute: 9, rejectedBefore: 0 }),
        named('Bob', { minute: 7, rejectedBefore: 1 }),
        named('Cy', { minute: 3 }),
      ],
      setup(),
    );
    expect(replays.map((replay) => [replay.label, replay.isUnranked])).toEqual([
      ['Bob', false],
      ['Zed', false],
      ['Ann', true],
      ['Cy', true],
    ]);
    expect(replays[1].events[0][1]).toBe(1);
  });

  it('ranks a ghost whose only gap is in a problem the contest no longer has', () => {
    const stale: GhostInput = {
      label: 'Old',
      caption: '',
      cells: [
        { problemId: 'gone', minute: 5, rejectedBefore: null, points: null },
        { problemId: 'a', minute: 9, rejectedBefore: 0, points: null },
      ],
    };
    expect(ghostReplays([stale], setup())[0].isUnranked).toBe(false);
  });
});
