import { sha256 } from '@libs/auth';
import { newId } from '@libs/database';
import type { Judge, Problem, Submission } from '@libs/database';
import type { BridgeTest } from './setup';

export { waitUntil } from '@libs/common/testing';

export async function seedCatalog(test: BridgeTest) {
  const [cpp, python] = await test.languages.create([
    {
      key: 'CPP17',
      name: 'C++17',
      commonName: 'C++',
      ace: 'c_cpp',
      pygments: 'cpp',
      extension: 'cpp',
    },
    {
      key: 'PY3',
      name: 'Python 3',
      commonName: 'Python',
      ace: 'python',
      pygments: 'python3',
      extension: 'py',
    },
  ]);
  const user = await test.users.create({
    username: 'alice',
    password: '!',
    isActive: true,
  });
  return { cpp, python, user };
}
export type BridgeCatalog = Awaited<ReturnType<typeof seedCatalog>>;

export const seedProblem = (
  test: BridgeTest,
  catalog: BridgeCatalog,
  overrides: Partial<Problem> & { code: string },
) =>
  test.problems.create({
    name: overrides.code.toUpperCase(),
    timeLimit: 2,
    memoryLimit: 262144,
    points: 1000,
    typeIds: [catalog.cpp._id],
    groupId: catalog.cpp._id,
    allowedLanguages: [catalog.cpp._id, catalog.python._id],
    isPublic: true,
    ...overrides,
  });

/** A submission row plus its source, source first as the api writes them: the external runner claims a queued row on its own timer, so the row never exists without its source. */
export async function seedSubmission(
  test: BridgeTest,
  catalog: BridgeCatalog,
  {
    problem,
    language = catalog.cpp._id,
    source = 'int main() {}',
    ...fields
  }: Partial<Submission> & { problem: string; source?: string },
) {
  const id = newId();
  await test.sources.create({ _id: id, source });
  return test.submissions.create({
    _id: id,
    user: catalog.user._id,
    problem,
    language,
    ...fields,
  });
}

/** A contest submission as the api writes it: the submission (with its contest) and its contest row. */
export async function seedContestSubmission(
  test: BridgeTest,
  catalog: BridgeCatalog,
  {
    contest,
    participation,
    problem,
    ...fields
  }: Partial<Submission> & {
    contest: string;
    participation: string;
    problem: string;
  },
) {
  const submission = await seedSubmission(test, catalog, {
    problem,
    contest,
    priority: 0,
    ...fields,
  });
  await test.contestSubmissions.create({
    _id: submission._id,
    participation,
    contest,
    problem,
  });
  return submission;
}

export const seedJudge = (
  test: BridgeTest,
  name: string,
  key: string,
  fields: Partial<Judge> = {},
) => test.judges.create({ name, authKeyHash: sha256(key), ...fields });
