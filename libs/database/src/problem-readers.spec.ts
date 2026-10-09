import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

type Treatment = 'F' | 'S' | 'F+S';

/**
 * Every file that reads the `problems` collection directly, and how it treats soft-deleted problems.
 * F: the not-deleted filter is applied. S: it deliberately sees deleted problems (the reason says why). F+S: both, per method.
 * A new file with such a read fails this spec until it is added here with a treatment; a file that stopped reading fails too.
 * Readers that go through `ProblemsRepository` (tags, comments, tickets, contests, judges, ...) inherit its filter and are not listed.
 */
const PROBLEM_READERS: Record<string, readonly [Treatment, string]> = {
  'apps/api/src/modules/home/home.repository.ts': [
    'F',
    'the newest list and the problem count show live problems only',
  ],
  'apps/api/src/modules/problems/core/problems.repository.ts': [
    'F+S',
    'every finder filters; the explicit *IncludingDeleted and *Deleted* methods are the only deliberate exceptions',
  ],
  'apps/api/src/modules/users/pages/user-pages.repository.ts': [
    'F',
    'solved lists and PP breakdowns count live public problems only',
  ],
  'apps/api/src/modules/similarity/core/similarity-runs.repository.ts': [
    'F+S',
    'starting and opening runs filters; problemCodes is S so evidence that survives keeps its names',
  ],
  'apps/bridge/src/submissions/submissions.repository.ts': [
    'S',
    'a submission queued before the delete must still be dispatched with the problem limits',
  ],
  'apps/bridge/src/submissions/run-writes.repository.ts': [
    'S',
    'a submission graded after the delete is still scored with the problem points it was judged against',
  ],
  'apps/api/src/modules/contests/feed/feed-data.repository.ts': [
    'S',
    'the event feed names every contest problem, including ones deleted since the contest',
  ],
  'apps/migrator/src/file-check.service.ts': [
    'S',
    'the post-migration file check verifies the files of every problem row, deleted or not',
  ],
  'apps/worker/src/jobs/contest-export/contest-export.repository.ts': [
    'S',
    'the export names every contest problem, including ones deleted since the contest',
  ],
  'apps/worker/src/jobs/contest-data/contest-data.repository.ts': [
    'F',
    'the contest data zip lists the contest problems that exist',
  ],
  'apps/worker/src/jobs/contest-publish/contest-publish.repository.ts': [
    'F',
    'a deleted problem reads as missing and is skipped as not_found instead of failing the run',
  ],
  'apps/worker/src/jobs/contribution-points/contribution-points.repository.ts':
    [
      'F',
      'a deleted suggested problem no longer counts as a public suggestion',
    ],
  'apps/worker/src/jobs/pdf-render/pdf-render.repository.ts': [
    'F',
    'a deleted problem is not rendered',
  ],
  'apps/worker/src/jobs/polygon-import/polygon-import.repository.ts': [
    'S',
    'the code-collision check must see deleted and tombstoned codes',
  ],
  'apps/worker/src/jobs/problem-package/problem-package.repository.ts': [
    'F',
    'a deleted problem is not packaged',
  ],
  'apps/worker/src/jobs/submission-effects/contest-results.repository.ts': [
    'F',
    'contest scoring reads the problems of the contest, which are live',
  ],
  'apps/worker/src/jobs/submission-effects/submission-effects.repository.ts': [
    'F+S',
    'findProblem is S (returns deletedAt so pending gradings finish without effects); the points lookup is F',
  ],
  'apps/worker/src/jobs/user-data/user-data-community.repository.ts': [
    'S',
    "a user's data export still names the problems of their own history",
  ],
  'apps/worker/src/jobs/user-data/user-data.repository.ts': [
    'S',
    "a user's data export still lists their submissions with the problem code",
  ],
};

const READ_PATTERNS = [
  /InjectModel\(\s*Problem\.name\s*\)/,
  /getModelToken\(\s*Problem\b/,
  /from:\s*['"]problems['"]/,
  /collection\(\s*['"]problems['"]\s*\)/,
  /Model<Problem>/,
  /\bProblem\.collection\b/,
];
const SKIPPED = [
  /\.spec\.ts$/,
  /\.e2e-spec\.ts$/,
  /[\\/]test[\\/]/,
  /[\\/]seed[\\/]/,
  /testing\.ts$/,
];
const ROOT = join(__dirname, '..', '..', '..');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory())
      return ['node_modules', 'dist'].includes(entry.name)
        ? []
        : sourceFiles(path);
    return path.endsWith('.ts') && !SKIPPED.some((skip) => skip.test(path))
      ? [path]
      : [];
  });
}

const readersFound = (): string[] =>
  ['apps', 'libs']
    .flatMap((folder) => sourceFiles(join(ROOT, folder)))
    .filter((file) => {
      const source = readFileSync(file, 'utf8');
      return READ_PATTERNS.some((pattern) => pattern.test(source));
    })
    .map((file) => relative(ROOT, file).split(sep).join('/'))
    .sort();

describe('direct readers of the problems collection', () => {
  it('are exactly the files classified in PROBLEM_READERS', () => {
    expect(readersFound()).toEqual(Object.keys(PROBLEM_READERS).sort());
  });

  it('each carry a treatment and a reason worth reading', () => {
    for (const [file, [treatment, reason]] of Object.entries(PROBLEM_READERS)) {
      expect({ file, treatment }).toEqual({
        file,
        treatment: expect.stringMatching(/^(F|S|F\+S)$/) as string,
      });
      expect(reason.length).toBeGreaterThanOrEqual(20);
    }
  });
});
