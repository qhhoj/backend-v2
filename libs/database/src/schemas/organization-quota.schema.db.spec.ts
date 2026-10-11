import mongoose from 'mongoose';
import { startMongo } from '../testing';
import type { TestMongo } from '../testing';
import { newId } from '../uuid';
import { OrganizationProblemSchema } from './organization-problem.schema';
import { OrganizationProblemTagSchema } from './organization-problem-tag.schema';
import { OrganizationUsageSchema } from './organization-usage.schema';

describe('organization problem and quota schemas', () => {
  let replSet: TestMongo;
  const Tags = mongoose.model('OrgTagSpec', OrganizationProblemTagSchema);
  const Links = mongoose.model('OrgLinkSpec', OrganizationProblemSchema);
  const Usages = mongoose.model('OrgUsageSpec', OrganizationUsageSchema);

  beforeAll(async () => {
    replSet = await startMongo();
    await mongoose.connect(replSet.getUri());
    await Promise.all(
      [Tags, Links, Usages].map((model) => model.syncIndexes()),
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
});
