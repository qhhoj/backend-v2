import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const SPECS = [
  'apps/api/test/comments.e2e-spec.ts',
  'apps/api/test/blog.e2e-spec.ts',
  'apps/api/test/submissions-read.e2e-spec.ts',
  'apps/api/test/auth-session.e2e-spec.ts',
  'apps/api/test/seo.e2e-spec.ts',
  'apps/bridge/test/judging.e2e-spec.ts',
  'libs/judging/src/jobs.db.spec.ts',
  'apps/api/src/modules/blog/core/blog-access.filters.db.spec.ts',
];
const ALWAYS = SPECS.filter((s) =>
  /submission|auth|bridge|judging|access/.test(s),
);
type Select = (
  all: string[],
  changed: string[],
  importers?: Record<string, Set<string>>,
) => string[];
// eslint-disable-next-line @typescript-eslint/no-require-imports
const load = async () =>
  require('./select-db-specs.cjs') as { selectDbSpecs: Select };

describe('selectDbSpecs', () => {
  it('runs the judging, submissions and auth specs plus those of the changed module', async () => {
    const { selectDbSpecs } = await load();
    expect(
      selectDbSpecs(SPECS, ['apps/api/src/modules/comments/posting/a.ts']),
    ).toEqual([
      'apps/api/test/comments.e2e-spec.ts',
      'apps/api/test/submissions-read.e2e-spec.ts',
      'apps/api/test/auth-session.e2e-spec.ts',
      'apps/bridge/test/judging.e2e-spec.ts',
      'libs/judging/src/jobs.db.spec.ts',
      'apps/api/src/modules/blog/core/blog-access.filters.db.spec.ts',
    ]);
  });

  it('adds the specs beside the changed file', async () => {
    const { selectDbSpecs } = await load();
    const picked = selectDbSpecs(SPECS, [
      'apps/api/src/modules/blog/core/x.ts',
    ]);
    expect(picked).toContain(
      'apps/api/src/modules/blog/core/blog-access.filters.db.spec.ts',
    );
    expect(picked).not.toContain('apps/api/test/seo.e2e-spec.ts');
  });

  it('selects only the always-set for docs, changesets and deploy scripts', async () => {
    const { selectDbSpecs } = await load();
    expect(
      selectDbSpecs(SPECS, [
        'docs/decisions.md',
        '.changeset/a.md',
        'deploy/ci/x.sh',
      ]),
    ).toEqual(ALWAYS);
  });

  it('selects everything for a file no module row covers', async () => {
    const { selectDbSpecs } = await load();
    for (const file of [
      'package-lock.json',
      'libs/common/src/x.ts',
      'libs/database/src/schemas/user.schema.ts',
      'apps/api/src/modules/new-module/a.ts',
      '.github/workflows/ci.yml',
    ])
      expect(selectDbSpecs(SPECS, [file])).toEqual(SPECS);
  });

  it('has a row for every API module (a module without one would run the whole suite)', async () => {
    const { selectDbSpecs } = await load();
    const modules = readdirSync(join(process.cwd(), 'apps/api/src/modules'), {
      withFileTypes: true,
    })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const name of modules)
      expect(
        selectDbSpecs(SPECS, [`apps/api/src/modules/${name}/x.ts`]),
      ).not.toEqual(SPECS);
  });

  it('selects everything for any change under libs/', async () => {
    const { selectDbSpecs } = await load();
    for (const file of [
      'libs/auth/src/guards/auth.guard.ts',
      'libs/judging/src/scoring.ts',
      'libs/problems/src/x.ts',
    ])
      expect(selectDbSpecs(SPECS, [file])).toEqual(SPECS);
  });

  it('always runs the access, guard and permission specs', async () => {
    const { selectDbSpecs } = await load();
    const specs = [
      'apps/api/test/admin-access.e2e-spec.ts',
      'apps/api/src/modules/problems/core/problem-access.db.spec.ts',
      'apps/api/test/seo.e2e-spec.ts',
    ];
    expect(selectDbSpecs(specs, ['docs/a.md'])).toEqual(specs.slice(0, 2));
  });

  it('adds the modules that import the changed module, transitively', async () => {
    const { selectDbSpecs } = await load();
    const importers = { seo: new Set(['blog']), blog: new Set(['comments']) };
    const picked = selectDbSpecs(
      SPECS,
      ['apps/api/src/modules/seo/a.ts'],
      importers,
    );
    expect(picked).toEqual(
      expect.arrayContaining([
        'apps/api/test/seo.e2e-spec.ts',
        'apps/api/test/blog.e2e-spec.ts',
        'apps/api/test/comments.e2e-spec.ts',
      ]),
    );
  });

  it('runs an edited spec by itself, and everything for an edited fixture', async () => {
    const { selectDbSpecs } = await load();
    const picked = selectDbSpecs(SPECS, ['apps/api/test/seo.e2e-spec.ts']);
    expect(picked).toContain('apps/api/test/seo.e2e-spec.ts');
    expect(picked).not.toContain('apps/api/test/comments.e2e-spec.ts');
    expect(selectDbSpecs(SPECS, ['apps/api/test/problem-fixtures.ts'])).toEqual(
      SPECS,
    );
  });
});
