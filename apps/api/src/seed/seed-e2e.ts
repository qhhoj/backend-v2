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

export interface SeedOptions {
  problemDataRoot: string;
  adminPassword: string;
  userPassword: string;
  /** Seals the mail URL row, the same key the api reads settings with. */
  encryptionKey: Buffer;
}
export interface SeedSummary {
  admin: string;
  user: string;
  problem: string;
  language: string;
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
  caseInsensitive = false,
): Promise<Row> {
  const query = model.findOne(filter);
  const existing = await (caseInsensitive ? query.collation(CI) : query).exec();
  return existing ?? (await model.create(fields));
}

export async function seedE2e(
  connection: Connection,
  options: SeedOptions,
): Promise<SeedSummary> {
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
      password: await hashPassword(options.adminPassword),
    },
    true,
  );
  const user = await ensure(
    users,
    { username: 'e2e_user' },
    {
      username: 'e2e_user',
      email: 'e2e_user@example.com',
      isActive: true,
      password: await hashPassword(options.userPassword),
    },
    true,
  );
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
    true,
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
  await ensure(
    connection.model<Setting>(Setting.name, SettingSchema),
    { _id: 'mail.smtpUrl' },
    {
      _id: 'mail.smtpUrl',
      value: sealSetting(
        SETTINGS['mail.smtpUrl'],
        MAILPIT_SMTP_URL,
        options.encryptionKey,
      ),
      updatedBy: null,
      updatedAt: new Date(),
    },
  );

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
  const data = { ...sample, cases: compiled.cases };
  await ensure(
    connection.model<Problem>(Problem.name, ProblemSchema),
    { code: 'e2e_sum' },
    {
      code: 'e2e_sum',
      name: 'A plus B',
      timeLimit: 1,
      memoryLimit: 262144,
      points: 1000,
      isPublic: true,
      date: new Date(),
      typeIds: [type._id],
      groupId: group._id,
      authors: [admin._id],
      allowedLanguages: [language._id],
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
      data,
    },
  );

  const directory = join(options.problemDataRoot, 'e2e_sum');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, '1.in'), '1 2\n');
  await writeFile(join(directory, '1.out'), '3\n');
  await writeFile(join(directory, 'init.yml'), compiled.yaml ?? '');
  return {
    admin: admin.username,
    user: user.username,
    problem: 'e2e_sum',
    language: language.key,
  };
}
