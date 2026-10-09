import { newId } from '@libs/database';
import { ProblemsRepository } from '../src/modules/problems/core/problems.repository';
import { createOrganization } from './organization-fixtures';
import { createProblem, seedCatalog } from './problem-fixtures';
import type { Catalog } from './problem-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('problem data bytes', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let repository: ProblemsRepository;
  let counter = 0;
  const orgProblem = (
    organizations: string[],
    dataBytes: number,
    extra: Record<string, unknown> = {},
  ) => {
    counter += 1;
    return createProblem(api, catalog, {
      code: `bytes${counter}`,
      isPublic: false,
      isOrganizationPrivate: true,
      organizations,
      dataBytes,
      ...extra,
    });
  };

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    repository = api.app.get(ProblemsRepository);
  });
  afterAll(() => api.teardown());

  it('sums private problems whose first listed organization it is', async () => {
    const first = await createOrganization(api);
    const second = await createOrganization(api);
    await orgProblem([first._id], 100);
    await orgProblem([first._id, second._id], 50);
    await orgProblem([second._id, first._id], 7000);
    await orgProblem([first._id], 9000, { isOrganizationPrivate: false });
    expect(await repository.sumDataBytes(first._id)).toBe(150);
    expect(await repository.sumDataBytes(second._id)).toBe(7000);
    expect(await repository.sumDataBytes(newId())).toBe(0);
  });

  it('answers many organizations at once and leaves unused ones out', async () => {
    const left = await createOrganization(api);
    const right = await createOrganization(api);
    await orgProblem([left._id], 3);
    const sums = await repository.sumDataBytesByOrganization([
      left._id,
      right._id,
    ]);
    expect(sums.get(left._id)).toBe(3);
    expect(sums.has(right._id)).toBe(false);
  });

  it('stops counting a purged problem and writes the size it is given', async () => {
    const organization = await createOrganization(api);
    const kept = await orgProblem([organization._id], 10);
    const purged = await orgProblem([organization._id], 90, {
      purgedAt: new Date(),
    });
    expect(await repository.sumDataBytes(organization._id)).toBe(10);
    await repository.setDataBytes(kept._id, 25);
    await repository.setDataBytes(purged._id, 0);
    expect(await repository.sumDataBytes(organization._id)).toBe(25);
  });
});
