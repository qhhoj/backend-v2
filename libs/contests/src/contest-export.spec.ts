import { contestDataPath } from './contest-data';
import { contestExportPath } from './contest-export';

const ID = '0192f1c2-7a3b-7c4d-8e5f-0123456789ab';

describe('contest export', () => {
  it('refuses anything that is not a contest id, so a path never leaves the root', () => {
    expect(() => contestExportPath('/data', '../etc/passwd')).toThrow(
      'Not a contest id',
    );
  });

  it('never collides with the data zip of the same contest', () => {
    expect(contestExportPath('/data', ID)).not.toBe(
      contestDataPath('/data', ID),
    );
  });
});
