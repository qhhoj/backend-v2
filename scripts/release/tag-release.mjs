// Tags HEAD as v<version> through the GitHub REST API (a git push of a tag is refused when the commit's
// workflow files differ from main's) and creates a GitHub Release whose notes are that version's
// CHANGELOG.md section; never publishes to npm. Needs gh and GITHUB_TOKEN/GH_TOKEN.
// Idempotent: a tag already at HEAD is left alone; a tag at another commit is an error.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const git = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const gh = (args, cwd, options = {}) =>
  (
    execFileSync('gh', args, { cwd, encoding: 'utf8', ...options }) ?? ''
  ).trim();

const REPO = process.env.GITHUB_REPOSITORY ?? '{owner}/{repo}';

/** The commit the remote tag points at, or '' when the tag does not exist. */
function remoteTagSha(tag, cwd) {
  return gh(
    [
      'api',
      `repos/${REPO}/git/matching-refs/tags/${tag}`,
      '--jq',
      `.[] | select(.ref == "refs/tags/${tag}") | .object.sha`,
    ],
    cwd,
  );
}

/** The CHANGELOG.md text under `## <version>`, up to the next `## ` heading. */
export function changelogSection(changelog, version) {
  const lines = changelog.split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start === -1) return '';
  const length = lines
    .slice(start + 1)
    .findIndex((line) => line.startsWith('## '));
  const end = length === -1 ? lines.length : start + 1 + length;
  return lines
    .slice(start + 1, end)
    .join('\n')
    .trim();
}

function createGithubRelease(tag, version, cwd) {
  const changelog = readFileSync(join(cwd, 'CHANGELOG.md'), 'utf8');
  const notes = join(mkdtempSync(join(tmpdir(), 'release-')), 'notes.md');
  writeFileSync(
    notes,
    changelogSection(changelog, version) || `Release ${tag}`,
  );
  gh(
    [
      'release',
      'create',
      tag,
      '--verify-tag',
      '--title',
      tag,
      '--notes-file',
      notes,
    ],
    cwd,
    {
      stdio: 'inherit',
    },
  );
}

/** Returns the tag it created, or null when `v<version>` already pointed at HEAD. */
export function tagRelease(cwd = process.cwd()) {
  const { version } = JSON.parse(
    readFileSync(join(cwd, 'package.json'), 'utf8'),
  );
  const tag = `v${version}`;
  const sha = git(['rev-parse', 'HEAD'], cwd);
  const existing = remoteTagSha(tag, cwd);
  if (existing === sha) {
    console.log(`${tag} already exists at ${sha}, nothing to do`);
    return null;
  }
  if (existing) {
    throw new Error(`${tag} already exists at ${existing}, not at ${sha}`);
  }
  gh(
    [
      'api',
      `repos/${REPO}/git/refs`,
      '-f',
      `ref=refs/tags/${tag}`,
      '-f',
      `sha=${sha}`,
    ],
    cwd,
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  console.log(`New tag: ${tag}`);
  createGithubRelease(tag, version, cwd);
  return tag;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) tagRelease();
