import { MigrationReport } from './migration-report';

describe('MigrationReport', () => {
  it('counts repeated messages once each and keeps first-seen order', () => {
    const report = new MigrationReport();
    report.add('dangling judge_problem:7');
    report.add('render limit (user) judge_comment:3');
    report.add('dangling judge_problem:7');
    expect(report.lines()).toEqual([
      'dangling judge_problem:7 (x2)',
      'render limit (user) judge_comment:3',
    ]);
  });

  it('logs at most 10 distinct lines and says how many it held back', () => {
    const report = new MigrationReport();
    for (let index = 0; index < 13; index++) report.add(`line ${index}`);
    const warn = jest.fn();
    report.flush('job', { warn });
    expect(warn).toHaveBeenCalledTimes(11);
    expect(warn).toHaveBeenLastCalledWith(
      'job: 3 more distinct report line(s) (all are in the report file)',
    );
  });
});
