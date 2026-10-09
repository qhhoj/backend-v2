import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeReportFile } from './report-file';

describe('writeReportFile', () => {
  it('saves every line of every job, not just the first few, readable by the owner only', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'report-')), 'r.txt');
    const many = Array.from(
      { length: 120 },
      (_unused, index) => `clamped judge_problem:${index}`,
    );
    await writeReportFile(path, {
      problems: many,
      contests: ['Lua judge_contest:3'],
    });
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(121);
    expect(lines[119]).toBe('problems: clamped judge_problem:119');
    expect(lines[120]).toBe('contests: Lua judge_contest:3');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
