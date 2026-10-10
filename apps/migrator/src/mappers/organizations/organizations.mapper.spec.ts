import type { MapCtx } from '../../mapper';
import { OrganizationsMapper } from './organizations.mapper';

describe('OrganizationsMapper', () => {
  it('marks every imported organization quota-unlimited (promotion) with no own caps', () => {
    const ctx = {
      ref: () => 'organization-id',
      refOrNull: () => null,
      bool: (value: number) => value === 1,
      render: () => '<p>about</p>',
      date: (value: Date) => value,
    } as unknown as MapCtx;
    const mapped = new OrganizationsMapper().map(
      {
        id: 1,
        name: 'Team',
        slug: 'team',
        short_name: 'T',
        about: 'about',
        creation_date: new Date('2020-01-01T00:00:00Z'),
        is_open: 1,
        slots: null,
        logo_override_image: null,
        performance_points: 0,
        member_count: 0,
        is_unlisted: 0,
      },
      ctx,
    );
    expect(mapped).toMatchObject({
      quotaUnlimited: true,
      quotaMonthlyCredits: null,
      quotaStorageBytes: null,
    });
  });
});
