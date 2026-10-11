import { chargedOrganizationOf } from './import-charge';

const ORGANIZATION = '0192b0e0-0000-7000-8000-000000000001';
const user = { isSuperuser: false };

describe('chargedOrganizationOf', () => {
  it('charges the organization a create names', () => {
    expect(
      chargedOrganizationOf(user, {
        mode: 'create',
        organizationId: ORGANIZATION,
      }),
    ).toBe(ORGANIZATION);
  });

  it.each([
    ['a site problem', user, { mode: 'create' as const }],
    [
      'an update',
      user,
      { mode: 'update' as const, organizationId: ORGANIZATION },
    ],
    [
      'a superuser',
      { isSuperuser: true },
      { mode: 'create' as const, organizationId: ORGANIZATION },
    ],
  ])('charges nobody for %s', (_case, principal, job) => {
    expect(chargedOrganizationOf(principal, job)).toBeNull();
  });
});
