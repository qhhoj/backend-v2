// Tags the version in package.json as v<version> and pushes the tag; never publishes to npm.
// Idempotent: a tag that exists locally or on origin is left alone. With GITHUB_TOKEN set it
// also creates a GitHub Release whose notes are that version's CHANGELOG.md section.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const git = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function tagExists(tag, cwd) {
  const local = git(['tag', '--list', tag], cwd);
  const remote = git(
    ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`],
    cwd,
  );
  return local !== '' || remote !== '';
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
  execFileSync(
    'gh',
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
    {
      cwd,
      stdio: 'inherit',
    },
  );
}

/** Returns the tag it created, or null when `v<version>` already existed. */
export function tagRelease(cwd = process.cwd(), env = process.env) {
  const { version } = JSON.parse(
    readFileSync(join(cwd, 'package.json'), 'utf8'),
  );
  const tag = `v${version}`;
  if (tagExists(tag, cwd)) {
    console.log(`${tag} already exists, nothing to do`);
    return null;
  }
  git(['-c', 'tag.gpgSign=false', 'tag', tag], cwd);
  git(['push', 'origin', `refs/tags/${tag}`], cwd);
  console.log(`New tag: ${tag}`);
  if (env.GITHUB_TOKEN) createGithubRelease(tag, version, cwd);
  return tag;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) tagRelease();
