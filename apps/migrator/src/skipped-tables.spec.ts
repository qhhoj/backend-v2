import { SKIPPED_TABLES, skippedLines } from './skipped-tables';

describe('SKIPPED_TABLES', () => {
  const tables = SKIPPED_TABLES.map((entry) => entry.table);

  it('lists the dropped badge tables and the re-rated rating table (user rulings)', () =>
    expect(tables).toEqual(
      expect.arrayContaining([
        'judge_badge',
        'judge_profile_badges',
        'judge_rating',
        'judge_judge',
        'judge_judge_problems',
        'judge_judge_runtimes',
      ]),
    ));
  it('names each table once, with a reason', () => {
    expect(new Set(tables).size).toBe(tables.length);
    expect(SKIPPED_TABLES.every((entry) => entry.reason.length > 0)).toBe(true);
  });
  it('renders one verify line per table', () =>
    expect(skippedLines()).toContain(
      'skipped by decision: judge_badge (badges dropped)',
    ));
});
