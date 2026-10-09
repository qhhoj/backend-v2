import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { hashPassword } from '@libs/auth';
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
import { compileInitYaml, DATA_WRITING_MARKER } from '@libs/problems';
import { SETTINGS, sealSetting } from '@libs/settings';
import type { Connection } from 'mongoose';
import { MAX_FILES, seedContests } from './seed-content';
import { ensure } from './seed-ensure';
import { writeIfChanged, zipBytes } from './seed-files';
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
  problems: string[];
  contests: string[];
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
export async function seedCatalog(connection: Connection) {
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

export interface ProblemSpec {
  code: string;
  name: string;
  description: string;
  /** Test files by name; case i uses `<i>.in` / `<i>.out`. */
  files: Record<string, string>;
  /** Set when the files are packed into this zip in the problem directory instead of written loose. */
  archive?: string;
}

const SUM_PROBLEM: ProblemSpec = {
  code: 'e2e_sum',
  name: 'A plus B',
  description: 'Read two integers, print their sum.',
  files: { '1.in': '1 2\n', '1.out': '3\n' },
};

const MAX_PROBLEM: ProblemSpec = {
  code: 'e2e_max',
  name: 'Max of two',
  description: 'Print the larger of two integers.',
  files: MAX_FILES,
  archive: 'tests.zip',
};

/** One test case per `N.in` file; 100 points in total, the last case takes the remainder. */
function casesOf(files: Record<string, string>) {
  const inputs = Object.keys(files)
    .filter((name) => name.endsWith('.in'))
    .sort();
  const each = Math.floor(100 / inputs.length);
  return inputs.map((input, index) => ({
    ...EMPTY_TEST_CASE,
    type: 'C' as const,
    input,
    output: input.replace(/\.in$/, '.out'),
    points: index === inputs.length - 1 ? 100 - each * index : each,
  }));
}

/** The problem row and its judge files under `problemDataRoot`; an existing row is kept. */
async function seedProblem(
  connection: Connection,
  {
    spec,
    catalog,
    authorId,
    problemDataRoot,
  }: {
    spec: ProblemSpec;
    catalog: Awaited<ReturnType<typeof seedCatalog>>;
    authorId: string;
    problemDataRoot: string;
  },
): Promise<string> {
  const sample = {
    ...emptyProblemData(),
    cases: casesOf(spec.files),
    archive: spec.archive ?? null,
  };
  const compiled = compileInitYaml(sample, new Set(Object.keys(spec.files)));
  const html = `<p>${spec.description}</p>`;
  const problem = await ensure(
    connection.model<Problem>(Problem.name, ProblemSchema),
    { code: spec.code },
    {
      code: spec.code,
      name: spec.name,
      timeLimit: 1,
      memoryLimit: 262144,
      points: 1000,
      isPublic: true,
      date: new Date(),
      typeIds: [catalog.type._id],
      groupId: catalog.group._id,
      authors: [authorId],
      allowedLanguages: [catalog.language._id],
      description: spec.description,
      descriptionHtml: html,
      translations: [
        {
          language: 'en',
          name: spec.name,
          description: spec.description,
          descriptionHtml: html,
        },
      ],
      data: { ...sample, cases: compiled.cases },
    },
  );
  await writeProblemFiles(join(problemDataRoot, spec.code), spec, {
    yaml: compiled.yaml,
    dataVersion: problem.dataVersion ?? 0,
  });
  return problem._id;
}

/** Under the judge's writing marker, the stamp last: a judge that reads it sees the files. */
async function writeProblemFiles(
  directory: string,
  { files, archive }: ProblemSpec,
  { yaml, dataVersion }: { yaml: string | null; dataVersion: number },
): Promise<void> {
  const marker = join(directory, DATA_WRITING_MARKER);
  await writeIfChanged(marker, '');
  try {
    await writeIfChanged(join(directory, 'init.yml'), yaml ?? '');
    if (archive)
      await writeIfChanged(join(directory, archive), await zipBytes(files));
    else
      for (const [name, content] of Object.entries(files))
        await writeIfChanged(join(directory, name), content);
    await writeIfChanged(join(directory, '.data-version'), `${dataVersion}\n`);
  } finally {
    await rm(marker, { force: true });
  }
}

export async function seedE2e(
  connection: Connection,
  options: SeedOptions,
): Promise<SeedSummary> {
  const { admin, user } = await seedUsers(connection, options);
  const catalog = await seedCatalog(connection);
  await seedMailSetting(connection, options.encryptionKey);
  await seedJudge(connection, options);
  const common = {
    catalog,
    authorId: admin._id,
    problemDataRoot: options.problemDataRoot,
  };
  const sumId = await seedProblem(connection, { spec: SUM_PROBLEM, ...common });
  const maxId = await seedProblem(connection, { spec: MAX_PROBLEM, ...common });
  const contests = await seedContests(connection, {
    authorId: admin._id,
    specs: [
      {
        key: 'e2e_live',
        name: 'E2E Live Round',
        startOffsetDays: -1,
        endOffsetDays: 30,
        formatName: 'icpc',
        problemIds: [sumId, maxId],
      },
      {
        key: 'e2e_past',
        name: 'E2E Past Round',
        startOffsetDays: -3,
        endOffsetDays: -2,
        formatName: 'default',
        problemIds: [sumId],
      },
    ],
  });
  return {
    admin: admin.username,
    user: user.username,
    problems: [SUM_PROBLEM.code, MAX_PROBLEM.code],
    contests,
    language: catalog.language.key,
    judge: options.judgeName,
  };
}
