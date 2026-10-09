import { contestDataPath } from './contest-data';
import {
  contestExportJobId,
  contestExportPath,
  contestExportTempPath,
} from './contest-export';
import { contestDataJobId } from './queues';

const ID = '0192f1c2-7a3b-7c4d-8e5f-0123456789ab';

describe('contest export paths', () => {
  it('puts the zip under the root, apart from the data zip, and a temp name is per run', () => {
    const path = contestExportPath('/data', ID);
    expect(path.startsWith('/data/')).toBe(true);
    expect(path).toContain(ID);
    expect(path).not.toBe(contestDataPath('/data', ID));
    expect(contestExportTempPath('/data', ID, 'run1')).not.toBe(
      contestExportTempPath('/data', ID, 'run2'),
    );
  });

  it('refuses anything that is not a contest id, so a path never leaves the root', () => {
    expect(() => contestExportPath('/data', '../etc/passwd')).toThrow(
      'Not a contest id',
    );
    expect(() => contestExportPath('/data', '')).toThrow('Not a contest id');
  });

  it('uses a job id of its own, so an export and a data prepare of one contest can both be queued', () => {
    expect(contestExportJobId(ID)).toContain(ID);
    expect(contestExportJobId(ID)).not.toBe(contestDataJobId(ID));
  });
});
