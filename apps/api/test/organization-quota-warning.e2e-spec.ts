import { NotificationsService } from '@libs/community';
import { QuotaService } from '../src/modules/organizations/quota/quota.service';
import { createOrganization } from './organization-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

interface Draft {
  kind: string;
  groupKey: string;
  path: string;
}

describe('quota 80 percent warning', () => {
  let api: ApiTest;
  let quota: QuotaService;
  const sent: Array<{ recipients: string[]; draft: Draft }> = [];
  const fake = {
    notify: jest.fn((recipients: string[], draft: Draft) => {
      sent.push({ recipients, draft });
      return Promise.resolve();
    }),
  };
  const request = {
    kind: 'problem' as const,
    userId: '0190a000-0000-7000-8000-000000000001',
    ref: 'r',
  };
  const spend = (organizationId: string, now?: Date) =>
    quota.charged(organizationId, request, () => Promise.resolve(1), now);

  beforeAll(async () => {
    api = await setupApiTest({
      overrides: [{ provide: NotificationsService, useValue: fake }],
    });
    quota = api.app.get(QuotaService);
    await api.setSetting('quota.cost.problem', 1);
  });
  beforeEach(() => {
    sent.length = 0;
    fake.notify.mockClear();
  });
  afterAll(() => api.teardown());

  it('tells the organization admins once, when credits first reach 80 percent of the month', async () => {
    const admin = '0190a000-0000-7000-8000-0000000000aa';
    const organization = await createOrganization(api, {
      adminIds: [admin],
      quotaMonthlyCredits: 10,
    });
    for (let count = 0; count < 7; count += 1) await spend(organization._id);
    expect(sent).toHaveLength(0);
    await spend(organization._id);
    await spend(organization._id);
    expect(sent).toHaveLength(1);
    expect(sent[0].recipients).toEqual([admin]);
    expect(sent[0].draft).toMatchObject({
      kind: 'quota-warning',
      path: `/organizations/${organization.slug}`,
    });
  });

  it('warns again in the next month', async () => {
    const organization = await createOrganization(api, {
      adminIds: ['0190a000-0000-7000-8000-0000000000cc'],
      quotaMonthlyCredits: 1,
    });
    await spend(organization._id, new Date('2026-10-10T00:00:00Z'));
    await spend(organization._id, new Date('2026-11-10T00:00:00Z'));
    expect(sent).toHaveLength(2);
  });

  it('warns about storage once, when it first reaches 80 percent', async () => {
    const admin = '0190a000-0000-7000-8000-0000000000bb';
    const organization = await createOrganization(api, {
      adminIds: [admin],
      quotaStorageBytes: 1000,
    });
    await quota.afterStorageWrite(organization._id, 700);
    expect(sent).toHaveLength(0);
    await quota.afterStorageWrite(organization._id, 850);
    expect(sent).toHaveLength(1);
    expect(sent[0].recipients).toEqual([admin]);
    expect(sent[0].draft.groupKey).toContain('storage');
    await quota.afterStorageWrite(organization._id, 900);
    expect(sent).toHaveLength(1);
  });

  it('never lets a failing notifier break the request, and does not resend', async () => {
    const organization = await createOrganization(api, {
      adminIds: ['0190a000-0000-7000-8000-0000000000dd'],
      quotaStorageBytes: 1000,
    });
    fake.notify.mockRejectedValueOnce(new Error('notifications down'));
    await expect(
      quota.afterStorageWrite(organization._id, 850),
    ).resolves.toBeUndefined();
    await quota.afterStorageWrite(organization._id, 900);
    expect(sent).toHaveLength(0);
  });
});
