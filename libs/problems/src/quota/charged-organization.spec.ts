import { chargedOrganization, ownerOrganization } from './charged-organization';

describe('ownerOrganization', () => {
  it('names the first listed organization of an organization-private subject', () => {
    expect(
      ownerOrganization({
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
  ])('has no owner for %s', (_name, subject) => {
    expect(ownerOrganization(subject)).toBeNull();
  });
});

describe('chargedOrganization', () => {
  const subject = { isOrganizationPrivate: true, organizations: ['org-a'] };

  it('charges the owner for anyone but a superuser', () => {
    expect(chargedOrganization({ isSuperuser: false }, subject)).toBe('org-a');
    expect(chargedOrganization({ isSuperuser: true }, subject)).toBeNull();
  });
});
