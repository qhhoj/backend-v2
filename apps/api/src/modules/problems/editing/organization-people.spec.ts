import type { Principal } from '@libs/auth';
import { organizationPeopleWaiver } from './organization-people';

const ADMIN = '0192b0e0-0000-7000-8000-00000000000a';
const CO_ADMIN = '0192b0e0-0000-7000-8000-00000000000b';
const MEMBER = '0192b0e0-0000-7000-8000-00000000000c';
const STAFF = '0192b0e0-0000-7000-8000-00000000000d';
const principalOf = (userId: string) => ({ userId }) as Principal;
const organization = { adminIds: [ADMIN, CO_ADMIN] };

describe('organizationPeopleWaiver', () => {
  it('opens authors and curators that name only administrators of the organization', () => {
    expect(
      organizationPeopleWaiver(principalOf(ADMIN), organization, {
        authors: [ADMIN],
        curators: [ADMIN, CO_ADMIN],
      }),
    ).toEqual(['authors', 'curators']);
  });

  it('keeps the gate of a field that names anyone else', () => {
    expect(
      organizationPeopleWaiver(principalOf(ADMIN), organization, {
        authors: [ADMIN, MEMBER],
        curators: [CO_ADMIN],
      }),
    ).toEqual(['curators']);
    expect(
      organizationPeopleWaiver(principalOf(ADMIN), organization, {
        curators: [MEMBER],
      }),
    ).toEqual(['authors']);
  });

  it('lets a requester who creates there without being an administrator name only themselves besides the administrators', () => {
    expect(
      organizationPeopleWaiver(principalOf(STAFF), organization, {
        authors: [STAFF, ADMIN],
      }),
    ).toEqual(['authors', 'curators']);
    expect(
      organizationPeopleWaiver(principalOf(MEMBER), organization, {
        authors: [STAFF],
      }),
    ).toEqual(['curators']);
  });
});
