import type { Permission } from '@libs/auth';
import type { Problem } from '@libs/database';
import { principalWith } from '../../../../test/problem-access-fixtures';
import type { OrganizationCreationRights } from '../../organizations/creation/organization-creation-rights.service';
import type { ProblemDocument } from '../core/problems.repository';
import { OrganizationProblemRules } from './organization-problem-rules.service';

const ALPHA = '0192f000-0000-7000-8000-00000000000a';
const BETA = '0192f000-0000-7000-8000-00000000000b';
const GONE = '0192f000-0000-7000-8000-0000000000ff';
const SLUGS = new Map([
  [ALPHA, 'alpha'],
  [BETA, 'beta'],
]);

/** The creation rule as `OrganizationCreationRights` answers it: live organizations are ALPHA and BETA, the viewer creates in `creates`. */
function rightsFor(creates: string[]): OrganizationCreationRights {
  const createsIn = (id: string) => SLUGS.has(id) && creates.includes(id);
  return {
    createsProblemsInEach: (_principal: unknown, ids: readonly string[]) =>
      Promise.resolve(ids.every(createsIn)),
    createsProblemsInAll: (_principal: unknown, ids: readonly string[]) =>
      Promise.resolve(ids.length > 0 && ids.every(createsIn)),
    firstSlug: (ids: readonly string[]) =>
      Promise.resolve(SLUGS.get(ids.find((id) => SLUGS.has(id)) ?? '') ?? null),
  } as unknown as OrganizationCreationRights;
}

const problem = (
  code: string,
  organizations: string[],
  isOrganizationPrivate = organizations.length > 0,
) => ({ code, organizations, isOrganizationPrivate }) as ProblemDocument;

interface Case {
  creates?: string[];
  permissions?: Permission[];
  isSuperuser?: boolean;
}

const forEdit = (
  original: ProblemDocument,
  fields: Partial<Problem>,
  { creates = [], permissions = [], isSuperuser = false }: Case = {},
) =>
  new OrganizationProblemRules(rightsFor(creates)).forEdit(
    principalWith({ isSuperuser }, 'judge.edit_own_problem', ...permissions),
    original,
    fields,
  );

const issueOf = async (run: Promise<unknown>) => {
  try {
    await run;
    return null;
  } catch (error) {
    const { status, extra } = error as {
      status: number;
      extra?: { issues?: { code: string }[] };
    };
    return `${status} ${extra?.issues?.[0]?.code}`;
  }
};

const ORGANIZATION_FIELDS = ['organizations', 'isOrganizationPrivate'];

describe('OrganizationProblemRules.forEdit: moving a problem between organizations', () => {
  describe('from one organization to another', () => {
    const original = problem('alpha_bai1', [ALPHA]);

    it('opens the organization fields with rights in both, renamed to the new prefix in the same save', async () => {
      await expect(
        forEdit(
          original,
          { organizations: [BETA], code: 'beta_bai1' },
          { creates: [ALPHA, BETA] },
        ),
      ).resolves.toEqual(ORGANIZATION_FIELDS);
    });

    it('keeps the old code on a move (no prefix check without a new code)', async () => {
      await expect(
        forEdit(
          original,
          { organizations: [BETA] },
          { creates: [ALPHA, BETA] },
        ),
      ).resolves.toEqual(ORGANIZATION_FIELDS);
    });

    it('refuses a new code typed in the same save without the new first organization prefix', async () => {
      expect(
        await issueOf(
          forEdit(
            original,
            { organizations: [BETA], code: 'alpha_bai2' },
            { creates: [ALPHA, BETA] },
          ),
        ),
      ).toBe('400 organization_code_prefix');
    });

    it.each([
      ['only the organization it leaves', [ALPHA]],
      ['only the organization it joins', [BETA]],
    ])('refuses with rights in %s', async (_case, creates) => {
      expect(
        await issueOf(
          forEdit(
            original,
            { organizations: [BETA], code: 'beta_bai1' },
            { creates },
          ),
        ),
      ).toBe('403 organization_rights');
    });

    it('refuses an organization that does not exist or was deleted', async () => {
      expect(
        await issueOf(
          forEdit(
            original,
            { organizations: [ALPHA, GONE] },
            { creates: [ALPHA] },
          ),
        ),
      ).toBe('403 organization_rights');
    });
  });

  describe('adding and removing a second organization', () => {
    it('adds one the editor creates in, the first one (and the code) unchanged', async () => {
      await expect(
        forEdit(
          problem('alpha_bai1', [ALPHA]),
          { organizations: [ALPHA, BETA] },
          { creates: [BETA] },
        ),
      ).resolves.toEqual(ORGANIZATION_FIELDS);
    });

    it('refuses to remove one the editor does not manage', async () => {
      expect(
        await issueOf(
          forEdit(
            problem('alpha_bai1', [ALPHA, BETA]),
            { organizations: [ALPHA] },
            { creates: [ALPHA] },
          ),
        ),
      ).toBe('403 organization_rights');
    });

    it('refuses a reorder that changes the first (charged) organization without rights in both', async () => {
      expect(
        await issueOf(
          forEdit(
            problem('alpha_bai1', [ALPHA, BETA]),
            { organizations: [BETA, ALPHA] },
            { creates: [BETA] },
          ),
        ),
      ).toBe('403 organization_rights');
    });

    it('keeps the code on a reorder with rights in both', async () => {
      await expect(
        forEdit(
          problem('alpha_bai1', [ALPHA, BETA]),
          { organizations: [BETA, ALPHA] },
          { creates: [ALPHA, BETA] },
        ),
      ).resolves.toEqual(ORGANIZATION_FIELDS);
    });
  });

  describe('from the site into an organization', () => {
    const site = problem('alpha_bai1', []);

    it('opens the organization fields with rights in the organization', async () => {
      await expect(
        forEdit(
          site,
          { organizations: [ALPHA], isOrganizationPrivate: true },
          { creates: [ALPHA] },
        ),
      ).resolves.toEqual(ORGANIZATION_FIELDS);
    });

    it('refuses without rights in it (membership is not enough)', async () => {
      expect(
        await issueOf(
          forEdit(
            site,
            { organizations: [ALPHA], isOrganizationPrivate: true },
            { permissions: ['judge.create_organization_problem'] },
          ),
        ),
      ).toBe('403 organization_rights');
    });

    it('keeps the code when a listed site problem only flips to private', async () => {
      await expect(
        forEdit(
          problem('bai1', [ALPHA], false),
          { isOrganizationPrivate: true },
          { creates: [ALPHA] },
        ),
      ).resolves.toEqual(ORGANIZATION_FIELDS);
    });
  });

  describe('from an organization onto the site', () => {
    const owned = problem('alpha_bai1', [ALPHA]);
    const toSite = { organizations: [], isOrganizationPrivate: false };

    it('opens the organization fields with rights in the organization and judge.add_problem', async () => {
      await expect(
        forEdit(owned, toSite, {
          creates: [ALPHA],
          permissions: ['judge.add_problem'],
        }),
      ).resolves.toEqual(ORGANIZATION_FIELDS);
    });

    it('refuses with site_problem_rights without judge.add_problem', async () => {
      expect(await issueOf(forEdit(owned, toSite, { creates: [ALPHA] }))).toBe(
        '403 site_problem_rights',
      );
    });

    it('refuses with organization_rights without rights in the organization it leaves', async () => {
      expect(
        await issueOf(
          forEdit(owned, toSite, { permissions: ['judge.add_problem'] }),
        ),
      ).toBe('403 organization_rights');
    });

    it('counts a flip to public as leaving every organization', async () => {
      expect(
        await issueOf(
          forEdit(
            owned,
            { isOrganizationPrivate: false },
            { creates: [ALPHA] },
          ),
        ),
      ).toBe('403 site_problem_rights');
    });
  });

  describe('site-wide editors and unrelated edits', () => {
    it('leaves judge.edit_all_problem holders to the staff gate (no organization rights needed)', async () => {
      await expect(
        forEdit(
          problem('alpha_bai1', [ALPHA]),
          { organizations: [], isOrganizationPrivate: false },
          { permissions: ['judge.edit_all_problem'] },
        ),
      ).resolves.toEqual([]);
    });

    it('still applies the prefix to a new code of a non-superuser judge.edit_all_problem holder', async () => {
      expect(
        await issueOf(
          forEdit(
            problem('alpha_bai1', [ALPHA]),
            { organizations: [BETA], code: 'bai2' },
            { permissions: ['judge.edit_all_problem'] },
          ),
        ),
      ).toBe('400 organization_code_prefix');
    });

    it('opens nothing when the organization fields do not change', async () => {
      await expect(
        forEdit(
          problem('alpha_bai1', [ALPHA]),
          { organizations: [ALPHA], name: 'Đổi tên' },
          {},
        ),
      ).resolves.toEqual([]);
    });
  });
});
