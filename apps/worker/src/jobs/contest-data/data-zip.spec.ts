import { planEntries, safeSegment } from './data-zip';
import type { DataRow } from './data-zip';

const row = (
  userId: string,
  username: string,
  code: string,
  {
    submissionId,
    extension = 'cpp',
  }: { submissionId: string; extension?: string },
): DataRow => ({ submissionId, userId, username, code, extension });

describe('planEntries', () => {
  it('keeps the best submission per user and problem at the top and the rest under $History', () => {
    expect(
      planEntries([
        row('u1', 'alice', 'sum', { submissionId: 's1' }),
        row('u1', 'alice', 'sum', { submissionId: 's2', extension: 'py' }),
        row('u1', 'alice', 'max', { submissionId: 's3' }),
        row('u2', 'bob', 'sum', { submissionId: 's4' }),
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
      row('u1', '../../etc', 'sum', { submissionId: 's1' }),
      row('u2', '..', 'sum', { submissionId: 's2', extension: '../x' }),
      row('u3', 'a/b', 'sum', { submissionId: 's3' }),
      row('u4', 'a_b', 'sum', { submissionId: 's4' }),
      row('u5', 'Nguyễn Văn', 'sum', { submissionId: 's5', extension: '' }),
      row('u6', '\u0000‮', 'sum', { submissionId: 's6' }),
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
      row('u1', 'alice', 'sum', { submissionId: 's1' }),
      row('u2', 'alice', 'sum', { submissionId: 's2' }),
      row('u1', 'alice', 'max', { submissionId: 's3' }),
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
