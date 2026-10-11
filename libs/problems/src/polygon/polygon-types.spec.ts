import {
  latestPackageOf,
  packageNotReadyReason,
  statementTitleOf,
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
  it('never offers a READY standard package, whose zip lacks the generated tests', () => {
    const onlyStandard = [
      ...standard(1500552, 3, 'READY'),
      ...standard(1500539, 2, 'READY'),
    ];
    expect(latestPackageOf(onlyStandard).state).toBe('NONE');
    expect(packageNotReadyReason(onlyStandard)).toBe(
      'its newest package 1500552 (revision 3) is a READY standard package, without the generated tests',
    );
  });

  it('takes the newest READY full package over a newer READY standard one', () => {
    expect(
      latestPackageOf([...standard(12, 5, 'READY'), ...rows(11, 4, 'READY')]),
    ).toMatchObject({ id: 11, revision: 4, state: 'READY' });
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
});
