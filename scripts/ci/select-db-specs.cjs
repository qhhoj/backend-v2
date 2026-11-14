// select-db-specs.cjs <base sha>: prints the DB specs (*.db.spec.ts, *.e2e-spec.ts) a PR must run, one path per line.
// The full DB suite runs nightly on origin/main (.batch/nightly); a PR runs
//   ALWAYS: the specs of judging, submissions, bridge and auth (wrong verdicts and broken auth are never "untouched"), plus
//   the specs of every module whose files the PR changed (MODULES below: path prefix -> spec path patterns).
// Fail-safe: a changed file no row covers (shared infrastructure, a new module, config, tests of unknown reach) selects
// the whole suite. Files that cannot change behaviour (docs, changesets, deploy scripts) select nothing extra.
const { execFileSync } = require('node:child_process');

const DB_SPEC = /\.(db\.spec|e2e-spec)\.ts$/;
const OPENAPI_E2E = /\/openapi\.e2e-spec\.ts$/; // has its own config (test/jest/openapi-db.config.js)

/** Judging, submissions, bridge, auth: run on every PR that touches code. */
const ALWAYS = [
  /^apps\/bridge\//,
  /^libs\/(judging|auth)\//,
  /^apps\/api\/test\/(submission|auth-|registration|totp|webauthn|impersonation|external-judge|contest-submit)/,
  /^apps\/api\/src\/modules\/(submissions|auth|judges)\//,
  /^apps\/worker\/test\/(contest-final-judge|effects|points|problem-rescore|contest-rescore|rescore-boot)/,
  /^libs\/database\/src\/schemas\/(submission|judge)/,
];

/** Files that change no behaviour a DB spec can see. */
const INERT =
  /^(.*\.md|docs\/.*|\.changeset\/.*|deploy\/.*|openapi\.json|\.github\/ISSUE_TEMPLATE\/.*)$/;

// A changed file selects the specs under the directory its row matches plus the listed ones (first matching row wins).
// A new apps/api module without a row makes its changes select everything (select-db-specs.spec.ts keeps this honest).
const API_TESTS = 'apps/api/test/';
const MODULES = [
  [/^(apps\/bridge|libs\/(judging|auth|judge-proto))\//, []], // ALWAYS covers their specs
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
  [
    /^libs\/contests\//,
    ['libs/contests/', `${API_TESTS}contest`, 'apps/worker/test/contest-'],
  ],
  [
    /^libs\/problems\//,
    [
      'libs/problems/',
      `${API_TESTS}problem`,
      'apps/worker/test/problem-',
      'apps/worker/test/polygon',
    ],
  ],
  [
    /^libs\/community\//,
    [
      'libs/community/',
      `${API_TESTS}comments`,
      `${API_TESTS}notification`,
      `${API_TESTS}ticket`,
      `${API_TESTS}blog`,
      `${API_TESTS}social`,
    ],
  ],
  [/^libs\/settings\//, ['libs/settings/', `${API_TESTS}site-settings`]],
  [
    /^libs\/render\//,
    ['apps/worker/test/pdf-render', `${API_TESTS}blog`, `${API_TESTS}comments`],
  ],
  [/^apps\/api\/test\/openapi\//, []], // the static OpenAPI job runs these
];

const startsWith = (path) => (prefix) => path.startsWith(prefix);

/** The DB specs <changed files> select out of <allSpecs>; every spec when a changed file has no row. */
function selectDbSpecs(allSpecs, changedFiles) {
  const selected = new Set(
    allSpecs.filter((spec) => ALWAYS.some((rx) => rx.test(spec))),
  );
  for (const file of changedFiles) {
    if (INERT.test(file)) continue;
    const row = MODULES.find(([rx]) => rx.test(file));
    if (!row) return [...allSpecs];
    const prefixes = [file.match(row[0])[0], ...row[1]];
    for (const spec of allSpecs.filter((s) => prefixes.some(startsWith(s))))
      selected.add(spec);
  }
  return allSpecs.filter((spec) => selected.has(spec));
}

function main(base) {
  const git = (args) =>
    execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean);
  const allSpecs = git(['ls-files', 'apps', 'libs']).filter(
    (f) => DB_SPEC.test(f) && !OPENAPI_E2E.test(f),
  );
  const changed =
    base && /^[0-9a-f]{7,40}$/.test(base) && !/^0+$/.test(base)
      ? git(['diff', '--name-only', base, 'HEAD'])
      : null;
  for (const spec of changed ? selectDbSpecs(allSpecs, changed) : allSpecs)
    console.log(spec);
}

if (require.main === module) main(process.argv[2]);

module.exports = { selectDbSpecs };
