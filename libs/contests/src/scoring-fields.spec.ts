import { scoringKeyOf } from './scoring-fields';
import type { ScoringKeyInput } from './scoring-fields';

const PROBLEM = '0192f000-0000-7000-8000-00000000000a';
const contest = (extra: Partial<ScoringKeyInput> = {}) =>
  ({
    formatName: 'default',
    formatConfig: {},
    startTime: new Date('2026-10-18T00:00:00Z'),
    endTime: new Date('2026-10-18T03:00:00Z'),
    timeLimit: null,
    frozenLastMinutes: 0,
    pointsPrecision: 3,
    problems: [{ problem: PROBLEM, points: 100, partial: true, order: 1 }],
    ...extra,
  }) as ScoringKeyInput;
const changes = (extra: Partial<ScoringKeyInput>) =>
  scoringKeyOf(contest(extra)) !== scoringKeyOf(contest());

describe('scoringKeyOf', () => {
  it.each<[string, Partial<ScoringKeyInput>]>([
    ['the format', { formatName: 'icpc' }],
    ['the start', { startTime: new Date('2026-10-17T23:00:00Z') }],
    ['the end', { endTime: new Date('2026-10-18T04:00:00Z') }],
    ['the precision', { pointsPrecision: 1 }],
    ['setting a time limit', { timeLimit: 3600 }],
    ['the freeze', { frozenLastMinutes: 30 }],
    [
      "a problem's points",
      {
        problems: [{ problem: PROBLEM, points: 50, partial: true, order: 1 }],
      } as Partial<ScoringKeyInput>,
    ],
    [
      "a problem's partial scoring",
      {
        problems: [{ problem: PROBLEM, points: 100, partial: false, order: 1 }],
      } as Partial<ScoringKeyInput>,
    ],
  ])('changes with %s', (_case, extra) => {
    expect(changes(extra)).toBe(true);
  });

  it("ignores a time limit's value and a problem's non-scoring options", () => {
    const limited = (timeLimit: number) => scoringKeyOf(contest({ timeLimit }));
    expect(limited(3600)).toBe(limited(7200));
    expect(limited(3600)).not.toBe(scoringKeyOf(contest()));
    expect(
      changes({
        problems: [
          {
            problem: PROBLEM,
            points: 100,
            partial: true,
            order: 1,
            maxSubmissions: 5,
          },
        ],
      } as Partial<ScoringKeyInput>),
    ).toBe(false);
  });
});
