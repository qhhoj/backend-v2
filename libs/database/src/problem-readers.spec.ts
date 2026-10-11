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
  'apps/api/src/modules/problems/polygon/polygon-links.repository.ts': [
    'S',
    'a deleted problem keeps its Polygon link (it comes back on restore), so the list marks it linked and a second link is refused; the link writes run after an editable-problem check',
  ],
  'apps/api/src/modules/users/pages/user-pages.repository.ts': [
    'F',
    'solved lists and PP breakdowns count live public problems only',
  ],
  'apps/api/src/modules/seo/seo.repository.ts': [
    'F',
    'the sitemap and link previews list signed-out-visible problems only: public, not organization-private, not deleted',
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
  'apps/worker/src/jobs/contest-export/contest-export.repository.ts': [
    'F+S',
    'the export names every contest problem, including ones deleted since the contest (S); the sources of any deleted problem are left out (F)',
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
  'apps/worker/src/jobs/polygon-import/polygon-sync-runs.repository.ts': [
    'S',
    'a failed sync of a problem deleted meanwhile still belongs to its history',
  ],
  'apps/worker/src/jobs/polygon-autosync/polygon-autosync.repository.ts': [
    'F',
    'only live problems are synced automatically',
  ],
  'apps/worker/src/jobs/problem-databytes/problem-databytes.repository.ts': [
    'S',
    "recomputes every problem's dataBytes from disk, deleted and purged ones included",
  ],
  'apps/worker/src/jobs/problem-purge/problem-purge.repository.ts': [
    'S',
    'the purge reads the deleted problems it is removing',
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

/** Calls that take `'problems'` first but name a field, a feed type or a route, not the collection. */
const NOT_COLLECTION_CALLS = ['invalidField', 'simple', 'Get'];

const READ_PATTERNS = [
  /InjectModel\(\s*Problem\.name\s*\)/,
  /getModelToken\(\s*Problem\b/,
  /\bmodel\(\s*(?:Problem\.name|['"]Problem['"])/,
  /Model<Problem>/,
  /\bProblem\.collection\b/,
  // The collection by name: a `$lookup`/reference (`from:`, `foreign:`) or any call that takes it first, e.g. `connection.collection('problems')`, `lookup('problems', ...)`, `each('problems', ...)`.
  /\b(?:from|foreign)\s*:\s*['"]problems['"]/,
  new RegExp(
    `\\b(?!(?:${NOT_COLLECTION_CALLS.join('|')})\\b)\\w+(?:<[^>()]*>)?\\(\\s*['"]problems['"]`,
  ),
];
const readsProblems = (source: string): boolean =>
  READ_PATTERNS.some((pattern) => pattern.test(source));
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
      return readsProblems(readFileSync(file, 'utf8'));
    })
    .map((file) => relative(ROOT, file).split(sep).join('/'))
    .sort();

describe('direct readers of the problems collection', () => {
  it.each([
    "connection.collection('problems').find({})",
    'db.collection("problems")',
    "connection.collection<Problem>('problems')",
    "this.each('problems', (id) => id)",
    "lookup('problems', 'problem', 'target')",
    "{ $lookup: { from: 'problems', localField: 'problem' } }",
    "{ field: 'problem', foreign: 'problems' }",
    '@InjectModel(Problem.name) private readonly problems: Model<Problem>',
    "connection.model('Problem')",
  ])('recognises a read written as %s', (source) => {
    expect(readsProblems(source)).toBe(true);
  });
  it.each([
    "throw invalidField('problems', 'Unknown problem.')",
    "simple('problems', problem.id, {})",
    "const KINDS = ['blog', 'problems'] as const",
  ])('ignores %s, which names no collection', (source) => {
    expect(readsProblems(source)).toBe(false);
  });

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

  it('names the deleted filter in every reader that claims to apply it', () => {
    for (const [file, [treatment]] of Object.entries(PROBLEM_READERS)) {
      if (treatment === 'S') continue;
      const source = readFileSync(join(ROOT, file), 'utf8');
      expect({
        file,
        mentionsFilter: /deletedAt|\bLIVE\b/.test(source),
      }).toEqual({ file, mentionsFilter: true });
    }
  });
});
