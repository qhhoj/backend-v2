import {
  competitionRanks,
  compareStandings,
  disqualify,
  rankingCacheKeys,
  standingOf,
} from './standings';
import type { ParticipationResults } from './standings';

const results = (
  extra: Partial<ParticipationResults> = {},
): ParticipationResults => ({
  score: 0,
  cumtime: 0,
  tiebreaker: 0,
  frozenScore: 0,
  frozenCumtime: 0,
  frozenTiebreaker: 0,
  formatData: {},
  frozenFormatData: {},
  isDisqualified: false,
  ...extra,
});

describe('compareStandings and competitionRanks (legacy order and ranker)', () => {
  it('puts the disqualified last, then score down, cumtime up, tiebreaker up, ties sharing a rank', () => {
    const rows = [
      {
        name: 'dq',
        isDisqualified: true,
        score: 900,
        cumtime: 0,
        tiebreaker: 0,
      },
      {
        name: 'slow',
        isDisqualified: false,
        score: 300,
        cumtime: 50,
        tiebreaker: 0,
      },
      {
        name: 'tieA',
        isDisqualified: false,
        score: 300,
        cumtime: 10,
        tiebreaker: 5,
      },
      {
        name: 'top',
        isDisqualified: false,
        score: 400,
        cumtime: 99,
        tiebreaker: 99,
      },
      {
        name: 'tieB',
        isDisqualified: false,
        score: 300,
        cumtime: 10,
        tiebreaker: 5,
      },
      {
        name: 'early',
        isDisqualified: false,
        score: 300,
        cumtime: 10,
        tiebreaker: 1,
      },
    ];
    const sorted = [...rows].sort(compareStandings);
    expect(sorted.map((row) => row.name).slice(0, 2)).toEqual(['top', 'early']);
    expect(sorted.map((row) => row.name).slice(4)).toEqual(['slow', 'dq']);
    expect(competitionRanks(sorted)).toEqual([1, 2, 3, 3, 5, 6]);
  });

  it('ranks an empty board as empty', () =>
    expect(competitionRanks([])).toEqual([]));
});

describe('standingOf', () => {
  const live = { A: { points: 100, time: 1530, tries: 2 } };
  const frozenCells = { A: { points: 0, time: null, tries: 2, pending: true } };
  const participation = results({
    score: 200,
    cumtime: 315,
    tiebreaker: 250,
    frozenScore: 100,
    frozenCumtime: 45,
    frozenTiebreaker: 25,
    formatData: { ...live, STALE: { points: 999 } },
    frozenFormatData: frozenCells,
  });

  it('shows the live fields when not frozen', () =>
    expect(standingOf(participation, false)).toEqual({
      score: 200,
      cumtime: 315,
      tiebreaker: 250,
      isDisqualified: false,
      cells: { ...live, STALE: { points: 999 } },
    }));

  it('a frozen standing never carries a live value', () => {
    const standing = standingOf(participation, true);
    expect(standing).toEqual({
      score: 100,
      cumtime: 45,
      tiebreaker: 25,
      isDisqualified: false,
      cells: frozenCells,
    });
    const serialized = JSON.stringify(standing);
    for (const liveOnly of ['200', '315', '250', '1530', '999', 'STALE'])
      expect(serialized).not.toContain(liveOnly);
  });
});

describe('standingOf on a lean read', () => {
  it.each([true, false])(
    'treats missing cells as empty (frozen %p)',
    (frozen) => {
      const lean = { ...results() } as Partial<ParticipationResults>;
      delete lean.formatData;
      delete lean.frozenFormatData;
      expect(standingOf(lean as ParticipationResults, frozen).cells).toEqual(
        {},
      );
    },
  );
});

describe('disqualify', () => {
  it('scores -9999 with no time, live and frozen, keeping the cells', () =>
    expect(
      disqualify({
        score: 500,
        cumtime: 40,
        tiebreaker: 7,
        frozenScore: 300,
        frozenCumtime: 20,
        frozenTiebreaker: 3,
        formatData: { A: { points: 500 } },
        frozenFormatData: { A: { points: 300 } },
      }),
    ).toEqual({
      score: -9999,
      cumtime: 0,
      tiebreaker: 0,
      frozenScore: -9999,
      frozenCumtime: 0,
      frozenTiebreaker: 0,
      formatData: { A: { points: 500 } },
      frozenFormatData: { A: { points: 300 } },
    }));
});

describe('rankingCacheKeys', () => {
  it('names four distinct keys per contest, one per {virtual, frozen}', () => {
    const keys = rankingCacheKeys('c1');
    expect(new Set(keys).size).toBe(4);
    expect(keys.every((key) => key.includes('c1'))).toBe(true);
    expect(rankingCacheKeys('c2').some((key) => keys.includes(key))).toBe(
      false,
    );
  });
});
