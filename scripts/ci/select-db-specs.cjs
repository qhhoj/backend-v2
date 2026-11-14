// select-db-specs.cjs <base sha>: prints the DB specs (*.db.spec.ts, *.e2e-spec.ts) a PR must run, one path per line.
// The full DB suite runs nightly on origin/main (.batch/nightly); a PR runs
//   ALWAYS: the specs of judging, submissions, bridge and auth (wrong verdicts and broken auth are never "untouched"), plus
//   the specs of every module whose files the PR changed (MODULES below: path prefix -> spec path patterns).
// Fail closed: a changed file no row covers (every file under libs/, shared infrastructure, a new module, config, a test
// fixture), an unknown base commit and any error in this script select the whole suite. Files that cannot change
// behaviour (docs, changesets, deploy scripts) select nothing extra. A changed API module also selects the modules that
// import it (the import graph of apps/api/src/modules, followed transitively).
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const DB_SPEC = /\.(db\.spec|e2e-spec)\.ts$/;
const OPENAPI_E2E = /\/openapi\.e2e-spec\.ts$/; // has its own config (test/jest/openapi-db.config.js)

/** Judging, submissions, bridge, auth and every access/permission spec: run on every PR that touches code. */
const ALWAYS = [
  /^apps\/bridge\//,
  /^libs\/(judging|auth)\//,
  /(access|guard|permission)[^/]*\.(db\.spec|e2e-spec)\.ts$/,
  /^apps\/api\/test\/(submission|auth-|admin-access|contest-problem-access|contest-exposure|contest-viewer-fields|registration|totp|webauthn|impersonation|external-judge|contest-submit)/,
  /^apps\/api\/src\/modules\/(submissions|auth|judges)\//,
  /^apps\/worker\/test\/(contest-final-judge|effects|points|problem-rescore|contest-rescore|rescore-boot)/,
  /^libs\/database\/src\/schemas\/(submission|judge)/,
];

/** Files that change no behaviour a DB spec can see. */
const INERT =
  /^(.*\.md|docs\/.*|\.changeset\/.*|deploy\/.*|openapi\.json|\.github\/ISSUE_TEMPLATE\/.*)$/;

// A changed file selects the specs under the directory its row matches plus the listed ones (first matching row wins).
// Every file under libs/ has no row on purpose: a shared library change runs everything.
// A new apps/api module without a row makes its changes select everything (select-db-specs.spec.ts keeps this honest).
const API_TESTS = 'apps/api/test/';
const MODULES = [
  [/^apps\/bridge\//, []], // ALWAYS covers its specs
  [
    /^apps\/api\/src\/modules\/submissions\//,
    [`${API_TESTS}contest-submission`],
  ],
  [/^apps\/api\/src\/modules\/audit\//, [`${API_TESTS}admin-`]],
  [
    /^apps\/api\/src\/modules\/auth\//,
    [
      `${API_TESTS}auth-`,
      `${API_TESTS}registration`,
      `${API_TESTS}totp`,
      `${API_TESTS}webauthn`,
      `${API_TESTS}impersonation`,
    ],
  ],
  [/^apps\/api\/src\/modules\/blog\//, [`${API_TESTS}blog`]],
  [/^apps\/api\/src\/modules\/comments\//, [`${API_TESTS}comments`]],
  [
    /^apps\/api\/src\/modules\/contests\//,
    [
      `${API_TESTS}contest`,
      `${API_TESTS}leaderboards`,
      `${API_TESTS}sync-contests`,
      'apps/worker/test/contest-',
    ],
  ],
  [
    /^apps\/api\/src\/modules\/contributions\//,
    [`${API_TESTS}problems-`, `${API_TESTS}social`],
  ],
  [
    /^apps\/api\/src\/modules\/events\//,
    [
      `${API_TESTS}contest-feed-stream`,
      `${API_TESTS}notification-streams`,
      `${API_TESTS}submission-streams`,
      `${API_TESTS}ticket-streams`,
    ],
  ],
  [/^apps\/api\/src\/modules\/home\//, [`${API_TESTS}site-misc`]],
  [/^apps\/api\/src\/modules\/judges\//, [`${API_TESTS}external-judge`]],
  [
    /^apps\/api\/src\/modules\/mail\//,
    [`${API_TESTS}registration`, `${API_TESTS}auth-account`],
  ],
  [
    /^apps\/api\/src\/modules\/notifications\//,
    [`${API_TESTS}notification`, 'apps/worker/test/notifications'],
  ],
  [
    /^apps\/api\/src\/modules\/organizations\//,
    [`${API_TESTS}organization`, `${API_TESTS}problem-organization`],
  ],
  [
    /^apps\/api\/src\/modules\/problems\//,
    [
      `${API_TESTS}problem`,
      `${API_TESTS}deleted-problem`,
      'apps/worker/test/problem-',
      'apps/worker/test/polygon',
    ],
  ],
  [/^apps\/api\/src\/modules\/shares\//, [`${API_TESTS}shares`]],
  [/^apps\/api\/src\/modules\/seo\//, [`${API_TESTS}seo`]],
  [
    /^apps\/api\/src\/modules\/settings\//,
    [`${API_TESTS}site-settings`, 'libs/settings/'],
  ],
  [/^apps\/api\/src\/modules\/short-links\//, [`${API_TESTS}short-links`]],
  [
    /^apps\/api\/src\/modules\/similarity\//,
    [`${API_TESTS}similarity`, 'apps/worker/test/similarity'],
  ],
  [
    /^apps\/api\/src\/modules\/site\//,
    [`${API_TESTS}site-`, `${API_TESTS}seed-e2e`],
  ],
  [/^apps\/api\/src\/modules\/sync\//, [`${API_TESTS}sync-`]],
  [
    /^apps\/api\/src\/modules\/tags\//,
    [`${API_TESTS}contest-tags`, `${API_TESTS}problems-`],
  ],
  [/^apps\/api\/src\/modules\/tickets\//, [`${API_TESTS}ticket`]],
  [/^apps\/api\/src\/modules\/user-activity\//, [`${API_TESTS}user-activity`]],
  [
    /^apps\/api\/src\/modules\/users\//,
    [`${API_TESTS}user-`, `${API_TESTS}social`, 'apps/worker/test/user-data'],
  ],
  [/^apps\/api\/src\/seed\//, [`${API_TESTS}seed-e2e`, 'apps/api/src/seed/']],
  [
    /^apps\/worker\/src\/migrations\//,
    ['apps/worker/src/migrations/', 'apps/worker/test/migrations-'],
  ],
  [/^apps\/worker\/(src|test)\//, ['apps/worker/']],
  [/^apps\/api\/test\/openapi\//, []], // the static OpenAPI job runs these
];

const startsWith = (path) => (prefix) => path.startsWith(prefix);
const MODULE_DIR = /^apps\/api\/src\/modules\/([^/]+)\//;

/** The modules that import <name>, directly or through other modules (importers: module -> Set of importing modules). */
function importersClosure(importers, name) {
  const seen = new Set();
  const queue = [name];
  while (queue.length > 0)
    for (const importer of importers[queue.pop()] ?? [])
      if (!seen.has(importer) && importer !== name) {
        seen.add(importer);
        queue.push(importer);
      }
  return [...seen];
}

/** The spec prefixes a changed file selects, or null when no row covers it (then the whole suite runs). */
function prefixesOf(file, importers) {
  const row = MODULES.find(([rx]) => rx.test(file));
  if (!row) return null;
  const prefixes = [file.match(row[0])[0], ...row[1]];
  const module = file.match(MODULE_DIR)?.[1];
  for (const importer of module ? importersClosure(importers, module) : []) {
    const importerRow = MODULES.find(([rx]) =>
      rx.test(`apps/api/src/modules/${importer}/x.ts`),
    );
    if (!importerRow) return null;
    prefixes.push(`apps/api/src/modules/${importer}/`, ...importerRow[1]);
  }
  return prefixes;
}

/** The DB specs <changed files> select out of <allSpecs>; every spec when a changed file has no row. */
function selectDbSpecs(allSpecs, changedFiles, importers = {}) {
  const selected = new Set(
    allSpecs.filter((spec) => ALWAYS.some((rx) => rx.test(spec))),
  );
  for (const file of changedFiles) {
    if (INERT.test(file)) continue;
    if (/^apps\/[^/]+\/test\//.test(file) && allSpecs.includes(file)) {
      selected.add(file); // an edited spec runs itself; a fixture has no row and runs everything
      continue;
    }
    const prefixes = prefixesOf(file, importers);
    if (!prefixes) return [...allSpecs];
    for (const spec of allSpecs.filter((s) => prefixes.some(startsWith(s))))
      selected.add(spec);
  }
  return allSpecs.filter((spec) => selected.has(spec));
}

/** module -> Set of the API modules whose sources import it (relative imports between apps/api/src/modules/*). */
function readImporters(sourceFiles) {
  const importers = {};
  for (const file of sourceFiles) {
    const from = file.match(MODULE_DIR)?.[1];
    if (!from || /\.spec\.ts$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const [, spec] of text.matchAll(/from '(\.[^']*)'/g)) {
      const to = path.posix
        .join(path.posix.dirname(file), spec)
        .match(MODULE_DIR)?.[1];
      if (to && to !== from) (importers[to] ??= new Set()).add(from);
    }
  }
  return importers;
}

function main(base) {
  const git = (args) =>
    execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 << 20 })
      .split('\n')
      .filter(Boolean);
  const allSpecs = git(['ls-files', 'apps', 'libs']).filter(
    (f) => DB_SPEC.test(f) && !OPENAPI_E2E.test(f),
  );
  if (allSpecs.length === 0) throw new Error('no DB specs found');
  let selected = allSpecs;
  try {
    if (base && /^[0-9a-f]{7,40}$/.test(base) && !/^0+$/.test(base)) {
      const changed = git([
        'diff',
        '--no-renames',
        '--name-only',
        base,
        'HEAD',
      ]); // a rename lists both paths
      const sources = git(['ls-files', 'apps/api/src/modules']).filter((f) =>
        f.endsWith('.ts'),
      );
      selected = selectDbSpecs(allSpecs, changed, readImporters(sources));
    }
  } catch (error) {
    console.error(`select-db-specs: ${error.message}; running every spec`);
  }
  for (const spec of selected) console.log(spec);
}

if (require.main === module) main(process.argv[2]);

module.exports = { selectDbSpecs, readImporters };
