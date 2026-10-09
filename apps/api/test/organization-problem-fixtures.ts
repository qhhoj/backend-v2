import type { Organization } from '@libs/database';
import { createOrganization } from './organization-fixtures';
import { createUserWith, loginAs } from './problem-fixtures';
import type { ApiTest } from './setup';

let worldCount = 0;

/** One organization with an admin, a plain member and an outsider, each with a live session. */
export async function seedOrganizationWorld(
  api: ApiTest,
  overrides: Partial<Organization> = {},
) {
  worldCount += 1;
  const person = async (name: string) => {
    const user = await createUserWith(api, `${name}${worldCount}`);
    return { user, session: await loginAs(api, user._id) };
  };
  const [admin, member, outsider] = await Promise.all([
    person('orgadmin'),
    person('orgmember'),
    person('outsider'),
  ]);
  const organization = await createOrganization(
    api,
    { adminIds: [admin.user._id], ...overrides },
    [member.user._id],
  );
  return { organization, admin, member, outsider };
}

export type OrganizationWorld = Awaited<
  ReturnType<typeof seedOrganizationWorld>
>;
