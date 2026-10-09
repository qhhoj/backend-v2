import { Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import {
  OrganizationCreditEntry,
  OrganizationUsage,
  newId,
} from '@libs/database';
import {
  ORGANIZATION_USAGE_AUDIT_QUEUE,
  ORGANIZATION_USAGE_AUDIT_SCHEDULER,
} from '@libs/community';
import type { Queue } from 'bullmq';
import type { Model } from 'mongoose';
import { OrganizationUsageAuditProcessor } from '../src/jobs/organization-usage-audit/organization-usage-audit.processor';
import { OrganizationUsageAuditService } from '../src/jobs/organization-usage-audit/organization-usage-audit.service';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

describe('organization usage audit', () => {
  let worker: WorkerTest;
  let audit: OrganizationUsageAuditService;
  let usage: Model<OrganizationUsage>;
  let ledger: Model<OrganizationCreditEntry>;
  const now = new Date('2026-10-15T12:00:00Z');
  const entry = (organization: string, month: string, amount: number) =>
    ledger.create({
      organization,
      month,
      reason: amount < 0 ? 'refund' : 'problem',
      amount,
    });
  /** Runs the audit and returns the parsed drift lines it logged. */
  const driftLines = async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    try {
      const result = await audit.audit(now);
      const lines = warn.mock.calls
        .map(([line]) => String(line))
        .filter((line) => line.includes('organization.usage.drift'))
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      return { result, lines };
    } finally {
      warn.mockRestore();
    }
  };

  beforeAll(async () => {
    worker = await setupWorkerTest();
    audit = worker.module.get(OrganizationUsageAuditService);
    usage = worker.module.get(getModelToken(OrganizationUsage.name));
    ledger = worker.module.get(getModelToken(OrganizationCreditEntry.name));
  });
  afterAll(() => worker.teardown());

  it('stays quiet when the counter equals the ledger sum, refunds included', async () => {
    const organization = newId();
    await usage.create({ organization, month: '2026-10', creditsUsed: 10 });
    await entry(organization, '2026-10', 10);
    await entry(organization, '2026-10', 10);
    await entry(organization, '2026-10', -10);
    const { result, lines } = await driftLines();
    expect(lines.filter((line) => line.organization === organization)).toEqual(
      [],
    );
    expect(result.checked).toBeGreaterThanOrEqual(1);
  });

  it('logs one line per drifted organization and month and changes nothing', async () => {
    const organization = newId();
    await usage.create({ organization, month: '2026-09', creditsUsed: 50 });
    await entry(organization, '2026-09', 30);
    const missing = newId();
    await entry(missing, '2026-10', 20);
    const { result, lines } = await driftLines();
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organization,
          month: '2026-09',
          ledger: 30,
          counter: 50,
        }),
        expect.objectContaining({
          organization: missing,
          month: '2026-10',
          ledger: 20,
          counter: 0,
        }),
      ]),
    );
    expect(result.drifted).toBeGreaterThanOrEqual(2);
    expect((await usage.findOne({ organization }).lean())?.creditsUsed).toBe(
      50,
    );
  });

  it('ignores months older than the previous one', async () => {
    const organization = newId();
    await usage.create({ organization, month: '2026-07', creditsUsed: 5 });
    await entry(organization, '2026-07', 99);
    const { lines } = await driftLines();
    expect(lines.filter((line) => line.organization === organization)).toEqual(
      [],
    );
  });

  it('looks back one calendar month even on the 31st of a long month', async () => {
    const organization = newId();
    await entry(organization, '2026-09', 7);
    const warn = jest.spyOn(Logger.prototype, 'warn');
    await audit.audit(new Date('2026-10-31T12:00:00Z'));
    const seen = warn.mock.calls.some(([line]) =>
      String(line).includes(organization),
    );
    warn.mockRestore();
    expect(seen).toBe(true);
  });

  it('registers its schedule with BullMQ', async () => {
    const queue = worker.module.get<Queue>(
      getQueueToken(ORGANIZATION_USAGE_AUDIT_QUEUE),
    );
    // The harness flushes Redis after boot, which drops the schedule; boot registers it again.
    await worker.module
      .get(OrganizationUsageAuditProcessor)
      .onApplicationBootstrap();
    const schedulers = await queue.getJobSchedulers();
    expect(schedulers.map((scheduler) => scheduler.key)).toContain(
      ORGANIZATION_USAGE_AUDIT_SCHEDULER,
    );
  });
});
