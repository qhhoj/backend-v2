import { latestPackageOf, statementTitleOf } from './polygon-types';
import type { PolygonPackageInfo } from './polygon-types';

const pkg = (
  id: number,
  revision: number,
  state: PolygonPackageInfo['state'],
): PolygonPackageInfo => ({ id, revision, state, creationTimeSeconds: 0 });

describe('latestPackageOf', () => {
  it('is NONE without packages', () => {
    expect(latestPackageOf([])).toEqual({
      id: null,
      revision: null,
      state: 'NONE',
    });
  });

  it('takes the highest revision, then the highest id, whatever the order', () => {
    expect(
      latestPackageOf([
        pkg(5, 3, 'READY'),
        pkg(9, 4, 'FAILED'),
        pkg(7, 4, 'READY'),
      ]),
    ).toEqual({ id: 9, revision: 4, state: 'FAILED' });
  });

  it('reads a pending build as RUNNING, so an older READY package is not offered while a newer one builds', () => {
    expect(
      latestPackageOf([pkg(1, 1, 'READY'), pkg(2, 2, 'PENDING')]).state,
    ).toBe('RUNNING');
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
