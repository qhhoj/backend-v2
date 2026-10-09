import { Status } from '@libs/judge-proto';
import { casesFor, verdictFor } from './fake-judge-verdict';

describe('fake judge verdicts', () => {
  const marker = '# fake-judge:WA';

  it('accepts a source without the marker', () => {
    expect(verdictFor('print(1)', marker)).toBe('AC');
  });

  it('answers wrong answer when the source carries the marker', () => {
    expect(verdictFor(`print(1)\n${marker}\n`, marker)).toBe('WA');
  });

  it('accepts everything when no marker is configured', () => {
    expect(verdictFor(`print(1)\n${marker}\n`, '')).toBe('AC');
  });

  it('reports one test case per configured count, numbered from 1, all failing on WA', () => {
    const cases = casesFor(2, 'WA');
    expect(cases.map((testCase) => testCase.position)).toEqual([1, 2]);
    expect(
      cases.every(
        (testCase) =>
          testCase.status === Status.STATUS_WA && testCase.points === 0,
      ),
    ).toBe(true);
  });

  it('gives full points to every case on AC', () => {
    const [only] = casesFor(1, 'AC');
    expect(only).toMatchObject({
      position: 1,
      status: Status.STATUS_AC,
      points: 1,
      total: 1,
    });
  });
});
