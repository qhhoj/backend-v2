import { chargedOrganization } from './quota-charge';

describe('chargedOrganization', () => {
  const user = { isSuperuser: false };
  it('charges the first listed organization of an organization-private subject', () => {
    expect(
      chargedOrganization(user, {
        isOrganizationPrivate: true,
        organizations: ['org-a', 'org-b'],
      }),
    ).toBe('org-a');
  });
  it.each([
    [
      'a public subject',
      { isOrganizationPrivate: false, organizations: ['a'] },
    ],
    ['no organization', { isOrganizationPrivate: true, organizations: [] }],
    ['an unset organization list', { isOrganizationPrivate: true }],
    ['nothing at all', {}],
  ])('exempts %s', (_name, subject) => {
    expect(chargedOrganization(user, subject)).toBeNull();
  });
  it('exempts superusers', () => {
    expect(
      chargedOrganization(
        { isSuperuser: true },
        { isOrganizationPrivate: true, organizations: ['org-a'] },
      ),
    ).toBeNull();
  });
});
