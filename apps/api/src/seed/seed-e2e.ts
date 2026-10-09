import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hashPassword } from '@libs/auth';
import { CI } from '@libs/database';
import {
  EMPTY_TEST_CASE,
  emptyProblemData,
  Language,
  LanguageSchema,
  Problem,
  ProblemGroup,
  ProblemGroupSchema,
  ProblemSchema,
  ProblemType,
  ProblemTypeSchema,
  Setting,
  SettingSchema,
  User,
  UserSchema,
} from '@libs/database';
import { compileInitYaml } from '@libs/problems';
import { SETTINGS, sealSetting } from '@libs/settings';
import type { Connection, FilterQuery, Model } from 'mongoose';
import { seedJudge } from './seed-judge';

export interface SeedOptions {
  problemDataRoot: string;
  adminPassword: string;
  userPassword: string;
  /** Seals the mail URL row, the same key the api reads settings with. */
  encryptionKey: Buffer;
  judgeName: string;
  judgeKey: string;
}
export interface SeedSummary {
  admin: string;
  user: string;
  problem: string;
  language: string;
  judge: string;
}

/** Mailpit from docker-compose.yml, the URL CONTRIBUTING gives for local mail. */
const MAILPIT_SMTP_URL = 'smtp://localhost:1025';

/** The seed writes known passwords: only a throwaway database may get them. */
export function assertSeedAllowed(nodeEnv: string | undefined): void {
  if (nodeEnv !== 'test' && nodeEnv !== 'development')
    throw new Error(
      `seed:e2e refuses to run unless NODE_ENV is test or development (got "${nodeEnv ?? ''}")`,
    );
}

/** The existing row, or a new one made from `fields`; an existing row is never touched. */
async function ensure<Row extends { _id: string }>(
  model: Model<Row>,
  filter: FilterQuery<Row>,
  fields: Partial<Row>,
  { isCaseInsensitive = false }: { isCaseInsensitive?: boolean } = {},
): Promise<Row> {
  const query = model.findOne(filter);
  const existing = await (
    isCaseInsensitive ? query.collation(CI) : query
  ).exec();
  return existing ?? (await model.create(fields));
}

const SAMPLE_PROBLEM_CODE = 'e2e_sum';

async function seedUsers(
  connection: Connection,
  { adminPassword, userPassword }: SeedOptions,
): Promise<{ admin: User; user: User }> {
  const users = connection.model<User>(User.name, UserSchema);
  const admin = await ensure(
    users,
    { username: 'e2e_admin' },
    {
      username: 'e2e_admin',
      email: 'e2e_admin@example.com',
      isActive: true,
      isStaff: true,
      isSuperuser: true,
      password: await hashPassword(adminPassword),
    },
    { isCaseInsensitive: true },
  );
  const user = await ensure(
    users,
    { username: 'e2e_user' },
    {
      username: 'e2e_user',
      email: 'e2e_user@example.com',
      isActive: true,
      password: await hashPassword(userPassword),
    },
    { isCaseInsensitive: true },
  );
  return { admin, user };
}

/** The language, type and group the sample problem needs. */
async function seedCatalog(connection: Connection) {
  const language = await ensure(
    connection.model<Language>(Language.name, LanguageSchema),
    { key: 'PY3' },
    {
      key: 'PY3',
      name: 'Python 3',
      commonName: 'Python',
      ace: 'python',
      pygments: 'python3',
      extension: 'py',
      includeInProblem: true,
    },
    { isCaseInsensitive: true },
  );
  const type = await ensure(
    connection.model<ProblemType>(ProblemType.name, ProblemTypeSchema),
    { name: 'uncategorized' },
    { name: 'uncategorized', fullName: 'Uncategorized' },
  );
  const group = await ensure(
    connection.model<ProblemGroup>(ProblemGroup.name, ProblemGroupSchema),
    { name: 'Uncategorized' },
    { name: 'Uncategorized', fullName: 'Uncategorized' },
  );
  return { language, type, group };
}

async function seedMailSetting(
  connection: Connection,
  encryptionKey: Buffer,
): Promise<void> {
  await ensure(
    connection.model<Setting>(Setting.name, SettingSchema),
    { _id: 'mail.smtpUrl' },
    {
      _id: 'mail.smtpUrl',
      value: sealSetting(
        SETTINGS['mail.smtpUrl'],
        MAILPIT_SMTP_URL,
        encryptionKey,
      ),
      updatedBy: null,
      updatedAt: new Date(),
    },
  );
}

/** A plus B with one test case, its row and its judge files under `problemDataRoot`. */
async function seedSampleProblem(
  connection: Connection,
  {
    catalog,
    authorId,
    problemDataRoot,
  }: {
    catalog: Awaited<ReturnType<typeof seedCatalog>>;
    authorId: string;
    problemDataRoot: string;
  },
): Promise<void> {
  const sample = {
    ...emptyProblemData(),
    cases: [
      {
        ...EMPTY_TEST_CASE,
        type: 'C' as const,
        input: '1.in',
        output: '1.out',
        points: 100,
      },
    ],
  };
  const compiled = compileInitYaml(sample, new Set(['1.in', '1.out']));
  const problemData = { ...sample, cases: compiled.cases };
  await ensure(
    connection.model<Problem>(Problem.name, ProblemSchema),
    { code: SAMPLE_PROBLEM_CODE },
    {
      code: SAMPLE_PROBLEM_CODE,
      name: 'A plus B',
      timeLimit: 1,
      memoryLimit: 262144,
      points: 1000,
      isPublic: true,
      date: new Date(),
      typeIds: [catalog.type._id],
      groupId: catalog.group._id,
      authors: [authorId],
      allowedLanguages: [catalog.language._id],
      description: 'Read two integers, print their sum.',
      descriptionHtml: '<p>Read two integers, print their sum.</p>',
      translations: [
        {
          language: 'en',
          name: 'A plus B',
          description: 'Read two integers, print their sum.',
          descriptionHtml: '<p>Read two integers, print their sum.</p>',
        },
      ],
      data: problemData,
    },
  );
  const directory = join(problemDataRoot, SAMPLE_PROBLEM_CODE);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, '1.in'), '1 2\n');
  await writeFile(join(directory, '1.out'), '3\n');
  await writeFile(join(directory, 'init.yml'), compiled.yaml ?? '');
}

export async function seedE2e(
  connection: Connection,
  options: SeedOptions,
): Promise<SeedSummary> {
  const { admin, user } = await seedUsers(connection, options);
  const catalog = await seedCatalog(connection);
  await seedMailSetting(connection, options.encryptionKey);
  await seedJudge(connection, options);
  await seedSampleProblem(connection, {
    catalog,
    authorId: admin._id,
    problemDataRoot: options.problemDataRoot,
  });
  return {
    admin: admin.username,
    user: user.username,
    problem: SAMPLE_PROBLEM_CODE,
    language: catalog.language.key,
    judge: options.judgeName,
  };
}
