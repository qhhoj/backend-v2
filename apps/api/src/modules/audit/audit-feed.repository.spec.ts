import { v7 } from 'uuid';
import { firstIdAt } from '@libs/database';
import { idRange } from './audit-feed.repository';

describe('audit feed id range', () => {
  const at = new Date('2026-10-11T08:00:00.123Z');
  const idAt = (date: Date) => v7({ msecs: date.getTime() });

  it('keeps the tighter of `to` and the page cursor as the upper bound', () => {
    const early = idAt(new Date('2026-01-01T00:00:00Z'));
    expect(idRange({ to: at, before: early })).toEqual({
      _id: { $lt: early },
    });
    const late = idAt(new Date('2027-01-01T00:00:00Z'));
    expect(idRange({ from: at, to: at, before: late })).toEqual({
      _id: { $gte: firstIdAt(at), $lt: firstIdAt(at) },
    });
    expect(idRange({})).toEqual({});
  });
});
