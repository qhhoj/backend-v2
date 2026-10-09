import mongoose from 'mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { startMongo } from '../testing';
import { newId } from '../uuid';
import {
  LEDGER_RETENTION_SECONDS,
  OrganizationCreditEntrySchema,
} from './organization-credit-entry.schema';
import { OrganizationProblemSchema } from './organization-problem.schema';
import { OrganizationProblemTagSchema } from './organization-problem-tag.schema';
import { OrganizationUsageSchema } from './organization-usage.schema';

describe('organization problem and quota schemas', () => {
  let replSet: MongoMemoryReplSet;
  const Tags = mongoose.model('OrgTagSpec', OrganizationProblemTagSchema);
  const Links = mongoose.model('OrgLinkSpec', OrganizationProblemSchema);
  const Usages = mongoose.model('OrgUsageSpec', OrganizationUsageSchema);
  const Ledger = mongoose.model('OrgLedgerSpec', OrganizationCreditEntrySchema);

  beforeAll(async () => {
    replSet = await startMongo();
    await mongoose.connect(replSet.getUri());
    await Promise.all(
      [Tags, Links, Usages, Ledger].map((model) => model.syncIndexes()),
    );
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  it('keeps one tag slug per organization but lets two organizations share it', async () => {
    const organization = newId();
    await Tags.create({ organization, slug: 'graphs', name: 'Graphs' });
    await expect(
      Tags.create({ organization, slug: 'graphs', name: 'Again' }),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      Tags.create({ organization: newId(), slug: 'graphs', name: 'Graphs' }),
    ).resolves.toBeDefined();
  });

  it('refuses a colour outside the token palette and a malformed slug', async () => {
    const organization = newId();
    await expect(
      Tags.create({ organization, slug: 'dp', name: 'DP', color: '#ff0000' }),
    ).rejects.toThrow(/color/);
    await expect(
      Tags.create({ organization, slug: 'Bad Slug', name: 'X' }),
    ).rejects.toThrow(/slug/);
  });

  it('keeps one link per organization and problem, archived and untagged by default', async () => {
    const fields = { organization: newId(), problem: newId() };
    const link = await Links.create(fields);
    expect(link.archived).toBe(false);
    expect(link.tagIds).toEqual([]);
    await expect(Links.create(fields)).rejects.toThrow(/duplicate key/);
  });

  it('keeps one usage row per organization and month and refuses a malformed month', async () => {
    const organization = newId();
    await Usages.create({ organization, month: '2026-10' });
    await expect(
      Usages.create({ organization, month: '2026-10' }),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      Usages.create({ organization, month: '2026-13' }),
    ).rejects.toThrow(/month/);
  });

  it('expires ledger rows after thirteen months', async () => {
    const indexes = await Ledger.collection.indexes();
    const expiring = indexes.find((index) => index.key.createdAt === 1);
    expect(expiring?.expireAfterSeconds).toBe(LEDGER_RETENTION_SECONDS);
    expect(LEDGER_RETENTION_SECONDS).toBeGreaterThan(12 * 31 * 86_400);
  });
});
