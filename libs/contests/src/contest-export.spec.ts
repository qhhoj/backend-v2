import { contestDataPath } from './contest-data';
import { contestExportJobId, contestExportPath } from './contest-export';
import { contestDataJobId } from './queues';

const ID = '0192f1c2-7a3b-7c4d-8e5f-0123456789ab';

describe('contest export', () => {
  it('refuses anything that is not a contest id, so a path never leaves the root', () => {
    expect(() => contestExportPath('/data', '../etc/passwd')).toThrow(
      'Not a contest id',
    );
  });

  it('never collides with the data zip or the data prepare job of the same contest', () => {
    expect(contestExportPath('/data', ID)).not.toBe(
      contestDataPath('/data', ID),
    );
    expect(contestExportJobId(ID)).not.toBe(contestDataJobId(ID));
  });
});
