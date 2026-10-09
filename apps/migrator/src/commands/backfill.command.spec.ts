import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BackfillCommand } from './backfill.command';

describe('BackfillCommand', () => {
  it('saves the full report to the --report path and prints that path', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'bf-')), 'report.txt');
    const lines = Array.from(
      { length: 80 },
      (_unused, index) => `dangling judge_problem:${index}`,
    );
    const migration = {
      backfill: jest.fn().mockResolvedValue({ problems: lines }),
    };
    const state = { begin: jest.fn() };
    const command = new BackfillCommand(migration as never, state as never);
    const log = jest.spyOn(command['logger'], 'log').mockImplementation();
    await command.run(['problems'], { fresh: true, report: path });
    expect(migration.backfill).toHaveBeenCalledWith(['problems'], true);
    expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(80);
    expect(log).toHaveBeenCalledWith(expect.stringContaining(path));
  });
});
