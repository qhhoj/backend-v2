import {
  latestPackageOf,
  newestPackageOf,
  packageNotReadyReason,
  statementLanguagesOf,
  statementTitleOf,
  variantOf,
} from './polygon-types';
import type { PolygonPackageInfo } from './polygon-types';

/** A package as Polygon lists it: one row per variant, three for a full package (the default), one for a standard. */
const rows = (
  id: number,
  revision: number,
  state: PolygonPackageInfo['state'],
  types = ['standard', 'linux', 'windows'],
): PolygonPackageInfo[] =>
  types.map((type) => ({ id, revision, state, type, creationTimeSeconds: 0 }));
const standard = (
  id: number,
  revision: number,
  state: PolygonPackageInfo['state'],
) => rows(id, revision, state, ['standard']);

describe('latestPackageOf', () => {
  it('is NONE without packages', () => {
    expect(latestPackageOf([])).toEqual({
      id: null,
      revision: null,
      state: 'NONE',
      type: null,
      createdAt: null,
    });
  });

  it('takes the highest revision, then the highest id, whatever the order', () => {
    expect(
      latestPackageOf([
        ...rows(5, 3, 'READY'),
        ...standard(9, 4, 'FAILED'),
        ...rows(7, 4, 'READY'),
      ]),
    ).toMatchObject({ id: 9, revision: 4, state: 'FAILED' });
  });

  it("gives the build time from Polygon's seconds as an ISO time", () => {
    expect(
      latestPackageOf([
        ...rows(3, 2, 'READY').map((row) => ({
          ...row,
          creationTimeSeconds: 1_760_000_000,
        })),
      ]).createdAt,
    ).toBe('2025-10-09T08:53:20.000Z');
  });

  it('reads a pending build as RUNNING, so an older READY package is not offered while a newer one builds', () => {
    expect(
      latestPackageOf([...rows(1, 1, 'READY'), ...standard(2, 2, 'PENDING')])
        .state,
    ).toBe('RUNNING');
  });
});

describe('latestPackageOf and standard packages', () => {
  it('is full for a package with a linux row, standard for one without', () => {
    expect(latestPackageOf(rows(3, 2, 'READY'))).toMatchObject({
      id: 3,
      type: 'full',
    });
    expect(latestPackageOf(standard(4, 2, 'READY'))).toMatchObject({
      id: 4,
      state: 'READY',
      type: 'standard',
    });
  });

  it('takes a full package of the same revision over a standard one, whichever id is newer', () => {
    expect(
      latestPackageOf([...standard(12, 5, 'READY'), ...rows(11, 5, 'READY')]),
    ).toMatchObject({ id: 11, type: 'full' });
    expect(
      latestPackageOf([...rows(12, 5, 'READY'), ...standard(11, 5, 'READY')]),
    ).toMatchObject({ id: 12, type: 'full' });
  });

  it('takes a newer standard package over an older full one: that would import stale content', () => {
    expect(
      latestPackageOf([...standard(12, 5, 'READY'), ...rows(11, 4, 'READY')]),
    ).toMatchObject({ id: 12, revision: 5, type: 'standard' });
  });

  it('never skips a newer build that is not READY, and has no type for it', () => {
    expect(
      latestPackageOf([...rows(11, 4, 'READY'), ...standard(12, 5, 'PENDING')]),
    ).toMatchObject({ id: 12, state: 'RUNNING', type: null });
    expect(
      latestPackageOf([...rows(11, 4, 'READY'), ...standard(12, 5, 'FAILED')]),
    ).toMatchObject({ id: 12, state: 'FAILED', type: null });
  });

  it('names the newest package and its state when it is not READY', () => {
    expect(
      packageNotReadyReason([
        ...rows(11, 4, 'READY'),
        ...standard(12, 5, 'FAILED'),
      ]),
    ).toBe('its newest package 12 (revision 5) is FAILED');
    expect(packageNotReadyReason([])).toBe('it has no package');
  });
});

describe('variantOf', () => {
  it('downloads linux for a full package and standard for a standard one', () => {
    expect(variantOf('full')).toBe('linux');
    expect(variantOf('standard')).toBe('standard');
  });
});

describe('statementTitleOf', () => {
  it('prefers Vietnamese, then English, then any named statement', () => {
    expect(
      statementTitleOf({
        english: { name: 'Sum' },
        vietnamese: { name: 'Tổng' },
      }),
    ).toBe('Tổng');
    expect(
      statementTitleOf({
        russian: { name: 'Сумма' },
        english: { name: 'Sum' },
      }),
    ).toBe('Sum');
    expect(statementTitleOf({ russian: { name: 'Сумма' } })).toBe('Сумма');
  });

  it('skips blank names and is null when nothing is named', () => {
    expect(
      statementTitleOf({
        vietnamese: { name: '  ' },
        english: { name: 'Sum' },
      }),
    ).toBe('Sum');
    expect(statementTitleOf({})).toBeNull();
  });

  it('gives the newest package with its state and Polygon comment, PENDING as RUNNING', () => {
    expect(
      newestPackageOf([
        ...rows(11, 4, 'READY'),
        {
          ...standard(12, 5, 'FAILED')[0],
          comment: '  Solution wa.cpp passed all tests ',
        },
      ]),
    ).toEqual({
      id: 12,
      revision: 5,
      state: 'FAILED',
      comment: 'Solution wa.cpp passed all tests',
    });
    expect(newestPackageOf(standard(13, 6, 'PENDING'))).toMatchObject({
      state: 'RUNNING',
      comment: null,
    });
    expect(newestPackageOf([])).toBeNull();
  });

  it('lists the statement languages with their title and tutorial, by name', () => {
    expect(
      statementLanguagesOf({
        vietnamese: { name: ' Tổng ', tutorial: 'Dùng tổng.' },
        english: { name: 'Sum', tutorial: '  ' },
        russian: {},
      }),
    ).toEqual([
      { language: 'english', title: 'Sum', hasTutorial: false },
      { language: 'russian', title: null, hasTutorial: false },
      { language: 'vietnamese', title: 'Tổng', hasTutorial: true },
    ]);
  });
});
