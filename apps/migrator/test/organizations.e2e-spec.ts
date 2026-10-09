import type { UUID } from 'mongodb';
import { uuidStr } from '@libs/database';
import { MigrationService } from '../src/migration.service';
import { setupMigratorTest } from './setup';

type OrganizationDoc = { adminIds: UUID[]; [field: string]: unknown };
type RequestDoc = { user: UUID; [field: string]: unknown };

describe('organizations jobs', () => {
  let harness: Awaited<ReturnType<typeof setupMigratorTest>>;
  let migration: MigrationService;
  let reports: Record<string, string[]>;

  beforeAll(async () => {
    harness = await setupMigratorTest();
    migration = harness.testingModule.get(MigrationService);
    reports = await migration.backfill([
      'organizations',
      'organization-requests',
    ]);
  });
  afterAll(() => harness.teardown());

  it('maps an organization with rendered about and admins as user ids', async () => {
    const organization = (await harness.docOf(
      'organizations',
      'judge_organization',
      2001,
    )) as unknown as OrganizationDoc;
    expect(organization).toMatchObject({
      name: 'Đội tuyển',
      slug: 'dt-2001',
      shortName: 'DT',
      isOpen: false,
      isUnlisted: false,
      slots: 30,
      logoOverrideImage: '/media/logo.png',
      createdAt: new Date('2021-02-03T04:05:06Z'),
    });
    expect(organization.aboutHtml).toContain('<em>xin chào</em>');
    expect(organization).not.toHaveProperty('accessCode');
    expect(organization.adminIds.map(uuidStr)).toEqual([
      uuidStr(await harness.uuidOf('auth_user', 1)),
    ]);
    expect(reports.organizations).toContain('dangling judge_profile:2999');
  });

  it('maps requests with time-ordered ids and skips orphaned or empty ones', async () => {
    const request = (await harness.docOf(
      'organizationRequests',
      'judge_organizationrequest',
      2001,
    )) as unknown as RequestDoc;
    expect(request).toMatchObject({
      state: 'A',
      reason: 'please',
      decidedBy: null,
      createdAt: new Date('2022-03-04T05:06:07Z'),
    });
    expect(uuidStr(request.user)).toBe(
      uuidStr(await harness.uuidOf('auth_user', 2)),
    );
    expect(
      await harness.docOf(
        'organizationRequests',
        'judge_organizationrequest',
        2002,
      ),
    ).toBeNull();
    expect(
      await harness.docOf(
        'organizationRequests',
        'judge_organizationrequest',
        2003,
      ),
    ).toBeNull();
    expect(reports['organization-requests']).toEqual(
      expect.arrayContaining([
        'skipped judge_organizationrequest:2002 (organization or user missing)',
        'skipped judge_organizationrequest:2003 (empty reason)',
      ]),
    );
  });

  it('keeps one pending request per organization and user', async () => {
    expect(
      await harness.docOf(
        'organizationRequests',
        'judge_organizationrequest',
        2004,
      ),
    ).toMatchObject({ state: 'P', reason: 'join' });
    expect(
      await harness.docOf(
        'organizationRequests',
        'judge_organizationrequest',
        2005,
      ),
    ).toBeNull();
    expect(reports['organization-requests']).toContain(
      'skipped judge_organizationrequest:2005 (duplicate pending)',
    );
  });

  it('treats a whitespace-only reason as blank when it picks the kept pending request', async () => {
    expect(
      await harness.docOf(
        'organizationRequests',
        'judge_organizationrequest',
        2006,
      ),
    ).toBeNull();
    expect(
      await harness.docOf(
        'organizationRequests',
        'judge_organizationrequest',
        2007,
      ),
    ).toMatchObject({
      state: 'P',
      reason: 'join after blank',
    });
    expect(reports['organization-requests']).toContain(
      'skipped judge_organizationrequest:2006 (empty reason)',
    );
  });

  it('verifies clean', async () => {
    expect(
      await migration.verify(['organizations', 'organization-requests']),
    ).toBe(0);
  });
});
