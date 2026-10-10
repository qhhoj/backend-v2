// The parity problems (judge-v2 cutover Task 5): data written like the api writes it (compileInitYaml), plus the runs.
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  Contest,
  ContestSchema,
  emptyProblemData,
  Language,
  LanguageSchema,
  Problem,
  ProblemSchema,
} from '@libs/database';
import type { ProblemData } from '@libs/database';
import {
  compileInitYaml,
  DATA_VERSION_FILE,
  DATA_WRITING_MARKER,
} from '@libs/problems';
import type { Connection } from 'mongoose';
import { seedCatalog } from './seed-e2e';
import { ensure } from './seed-ensure';
import { writeIfChanged, zipBytes } from './seed-files';
import {
  PARITY_CONTEST,
  PARITY_PROBLEMS,
  type ParityProblem,
} from './seed-parity-data';

export interface ParityRun {
  label: string;
  problem: string;
  language: string;
  source: string;
  fileBase64?: string;
  contest?: string;
}
export interface ParityManifest {
  languages: Record<string, string>;
  runs: ParityRun[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

const LANGUAGES = [
  {
    key: 'PY3',
    name: 'Python 3',
    commonName: 'Python',
    ace: 'python',
    pygments: 'python3',
    extension: 'py',
  },
  {
    key: 'CPP17',
    name: 'C++17',
    commonName: 'C++',
    ace: 'c_cpp',
    pygments: 'cpp',
    extension: 'cpp',
  },
  {
    key: 'TEXT',
    name: 'Text',
    commonName: 'Text',
    ace: 'text',
    pygments: 'text',
    extension: 'txt',
  },
  {
    key: 'OUTPUT',
    name: 'Output (zip)',
    commonName: 'Output',
    ace: 'text',
    pygments: 'text',
    extension: 'zip',
    fileOnly: true,
    fileSizeLimit: 1,
    includeInProblem: false,
  },
];

interface SeedContext {
  root: string;
  authorId: string;
  languageIds: string[];
  catalog: Awaited<ReturnType<typeof seedCatalog>>;
}

async function seedLanguages(
  connection: Connection,
): Promise<Record<string, string>> {
  const model = connection.model<Language>(Language.name, LanguageSchema);
  const ids: Record<string, string> = {};
  for (const language of LANGUAGES) {
    const row = await ensure(
      model,
      { key: language.key },
      // Like seed-e2e: OUTPUT is never a default language for new problems.
      { includeInProblem: true, ...language },
      { isCaseInsensitive: true },
    );
    ids[language.key] = row._id;
  }
  return ids;
}

async function writeCaseFiles(
  directory: string,
  problem: ParityProblem,
): Promise<void> {
  if (problem.archive) {
    await writeIfChanged(
      join(directory, problem.archive),
      await zipBytes(problem.caseFiles),
    );
    return;
  }
  for (const [name, content] of Object.entries(problem.caseFiles))
    await writeIfChanged(join(directory, name), content);
}

/** Under the judge's writing marker, the `.data-version` stamp last (judge-v2 reads only stamped data). */
async function writeFiles(
  directory: string,
  problem: ParityProblem,
  yaml: string,
  dataVersion: number,
): Promise<void> {
  const marker = join(directory, DATA_WRITING_MARKER);
  await writeIfChanged(marker, '');
  try {
    await writeIfChanged(join(directory, 'init.yml'), yaml);
    for (const [name, content] of Object.entries(problem.dataFiles ?? {}))
      await writeIfChanged(join(directory, name), content);
    await writeCaseFiles(directory, problem);
    await writeIfChanged(
      join(directory, DATA_VERSION_FILE),
      `${dataVersion}\n`,
    );
  } finally {
    await rm(marker, { force: true });
  }
}

function problemFields(
  problem: ParityProblem,
  data: ProblemData,
  context: SeedContext,
): Partial<Problem> {
  const html = `<p>${problem.code}</p>`;
  return {
    code: problem.code,
    name: problem.code,
    timeLimit: 1,
    memoryLimit: 262144,
    points: 1000,
    partial: problem.partial ?? true,
    isPublic: true,
    date: new Date(),
    authors: [context.authorId],
    allowedLanguages: context.languageIds,
    typeIds: [context.catalog.type._id],
    groupId: context.catalog.group._id,
    description: problem.code,
    descriptionHtml: html,
    data,
  };
}

async function seedOne(
  connection: Connection,
  problem: ParityProblem,
  context: SeedContext,
): Promise<string> {
  const data: ProblemData = {
    ...emptyProblemData(),
    ...problem.data,
    archive: problem.archive ?? null,
  };
  const compiled = compileInitYaml(
    data,
    new Set(Object.keys(problem.caseFiles)),
  );
  const row = await ensure(
    connection.model<Problem>(Problem.name, ProblemSchema),
    { code: problem.code },
    problemFields(problem, { ...data, cases: compiled.cases }, context),
  );
  await writeFiles(
    join(context.root, problem.code),
    problem,
    compiled.yaml ?? '',
    row.dataVersion ?? 0,
  );
  return row._id;
}

/** The live contest whose problem runs pretests only: `runPretestsOnly` on the contest, `isPretested` on the problem. */
async function seedContest(
  connection: Connection,
  authorId: string,
  problemId: string,
): Promise<void> {
  const now = Date.now();
  await ensure(
    connection.model<Contest>(Contest.name, ContestSchema),
    { key: PARITY_CONTEST },
    {
      key: PARITY_CONTEST,
      name: 'Parity pretests',
      summary: 'Parity run',
      description: 'Parity run',
      descriptionHtml: '<p>Parity run</p>',
      authors: [authorId],
      startTime: new Date(now - DAY_MS),
      endTime: new Date(now + 30 * DAY_MS),
      isVisible: true,
      formatName: 'default',
      runPretestsOnly: true,
      problems: [
        {
          problem: problemId,
          points: 100,
          partial: true,
          isPretested: true,
          order: 0,
        },
      ],
    } as Partial<Contest>,
  );
}

async function runsOf(problem: ParityProblem): Promise<ParityRun[]> {
  const runs: ParityRun[] = [];
  for (const run of problem.runs)
    runs.push({
      label: `${problem.code}/${run.language}/${run.name}`,
      problem: problem.code,
      language: run.language,
      source: run.source,
      ...(run.file
        ? { fileBase64: (await zipBytes(run.file)).toString('base64') }
        : {}),
      ...(problem.contest ? { contest: problem.contest } : {}),
    });
  return runs;
}

export async function seedParity(
  connection: Connection,
  { problemDataRoot, authorId }: { problemDataRoot: string; authorId: string },
): Promise<ParityManifest> {
  const languages = await seedLanguages(connection);
  const catalog = await seedCatalog(connection);
  const context: SeedContext = {
    root: problemDataRoot,
    authorId,
    languageIds: Object.values(languages),
    catalog,
  };
  const runs: ParityRun[] = [];
  for (const problem of PARITY_PROBLEMS) {
    const id = await seedOne(connection, problem, context);
    if (problem.contest) await seedContest(connection, authorId, id);
    runs.push(...(await runsOf(problem)));
  }
  // Contest runs last: submit-all joins the contest once and leaves at the end.
  return {
    languages,
    runs: [
      ...runs.filter((run) => !run.contest),
      ...runs.filter((run) => run.contest),
    ],
  };
}
