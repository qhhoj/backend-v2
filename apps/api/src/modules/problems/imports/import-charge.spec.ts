import { meteredOrganizationOf } from './import-charge';

const ORGANIZATION = '0192b0e0-0000-7000-8000-000000000001';

describe('meteredOrganizationOf', () => {
  it('meters the organization a create is for', () => {
    expect(meteredOrganizationOf({ isSuperuser: false }, ORGANIZATION)).toBe(
      ORGANIZATION,
    );
  });

  it('meters nothing for a site problem or a superuser', () => {
    expect(meteredOrganizationOf({ isSuperuser: false }, null)).toBeNull();
    expect(
      meteredOrganizationOf({ isSuperuser: true }, ORGANIZATION),
    ).toBeNull();
  });
});
