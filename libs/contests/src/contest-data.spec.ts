import { newId } from '@libs/database';
import {
  canPrepareData,
  contestDataPath,
  contestDataTempPath,
} from './contest-data';

describe('contest data paths', () => {
  it('builds paths inside the root from a contest id only', () => {
    const id = newId();
    expect(contestDataPath('/srv/data', id)).toBe(`/srv/data/${id}.zip`);
    expect(contestDataTempPath('/srv/data', id)).toBe(
      `/srv/data/${id}.zip.tmp`,
    );
    expect(() => contestDataPath('/srv/data', '../etc/passwd')).toThrow();
  });

  it('allows a new prepare when never prepared, after 24 hours, or when the zip is missing', () => {
    const now = new Date('2026-01-02T00:00:00Z');
    expect(canPrepareData(null, true, now)).toBe(true);
    expect(canPrepareData(new Date('2026-01-01T00:00:01Z'), true, now)).toBe(
      false,
    );
    expect(canPrepareData(new Date('2026-01-01T00:00:01Z'), false, now)).toBe(
      true,
    );
    expect(canPrepareData(new Date('2026-01-01T00:00:00Z'), true, now)).toBe(
      false,
    );
    expect(canPrepareData(new Date('2025-12-31T23:59:59Z'), true, now)).toBe(
      true,
    );
  });
});
