import { planEntries, safeSegment } from './data-zip';
import type { DataRow } from './data-zip';

const row = (
  userId: string,
  username: string,
  code: string,
  submissionId: string,
  extension = 'cpp',
): DataRow => ({ submissionId, userId, username, code, extension });

describe('planEntries', () => {
  it('keeps the best submission per user and problem at the top and the rest under $History', () => {
    expect(
      planEntries([
        row('u1', 'alice', 'sum', 's1'),
        row('u1', 'alice', 'sum', 's2', 'py'),
        row('u1', 'alice', 'max', 's3'),
        row('u2', 'bob', 'sum', 's4'),
      ]).map((entry) => entry.name),
    ).toEqual([
      'alice/sum.cpp',
      'alice/$History/sum_s2.py',
      'alice/max.cpp',
      'bob/sum.cpp',
    ]);
  });

  it('contains hostile usernames and extensions', () => {
    const names = planEntries([
      row('u1', '../../etc', 'sum', 's1'),
      row('u2', '..', 'sum', 's2', '../x'),
      row('u3', 'a/b', 'sum', 's3'),
      row('u4', 'a_b', 'sum', 's4'),
      row('u5', 'Nguyễn Văn', 'sum', 's5', ''),
      row('u6', '\u0000‮', 'sum', 's6'),
    ]).map((entry) => entry.name);
    expect(names).toEqual([
      '.._.._etc/sum.cpp',
      '__/sum.x',
      'a_b/sum.cpp',
      'a_b_2/sum.cpp',
      'Nguyễn_Văn/sum.txt',
      '___2/sum.cpp',
    ]);
    for (const name of names) {
      expect(
        name
          .split('/')
          .every(
            (segment) => segment !== '' && segment !== '.' && segment !== '..',
          ),
      ).toBe(true);
      expect(name.startsWith('/')).toBe(false);
    }
  });

  it("gives one folder to all of a user's rows, whatever the name", () => {
    const names = planEntries([
      row('u1', 'alice', 'sum', 's1'),
      row('u2', 'alice', 'sum', 's2'),
      row('u1', 'alice', 'max', 's3'),
    ]).map((entry) => entry.name);
    expect(names).toEqual([
      'alice/sum.cpp',
      'alice_2/sum.cpp',
      'alice/max.cpp',
    ]);
  });
});

describe('safeSegment', () => {
  it('never returns an empty or dot-only segment and caps the length', () => {
    for (const name of ['', '.', '..', '...', '/', '\u0000'])
      expect(['', '.', '..']).not.toContain(safeSegment(name));
    expect(safeSegment('x'.repeat(500)).length).toBeLessThanOrEqual(64);
  });
});
