import type { Organization } from '@libs/database';
import type { ApiTest } from './setup';

let organizationCount = 0;

/** A listed, open organization unless `overrides` say otherwise; members are written straight to `users.organizations`. */
export async function createOrganization(
  api: ApiTest,
  overrides: Partial<Organization> = {},
  memberIds: string[] = [],
) {
  organizationCount += 1;
  const slug = overrides.slug ?? `org${organizationCount}`;
  const organization = await api.organizations.create({
    name: `Organization ${organizationCount}`,
    slug,
    shortName: slug.slice(0, 20),
    isOpen: true,
    isUnlisted: false,
    ...overrides,
  });
  const members = [...new Set([...memberIds, ...(overrides.adminIds ?? [])])];
  if (members.length)
    await api.users.updateMany(
      { _id: { $in: members } },
      { $push: { organizations: organization._id } },
    );
  return organization;
}

export const organizationUrl = (slug: string, suffix = '') =>
  `/api/internal/organizations/${slug}${suffix}`;
