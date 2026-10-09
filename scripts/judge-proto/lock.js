#!/usr/bin/env node
// libs/judge-proto/proto.lock.json records the judge-v2 tag and commit `proto/` was vendored from and the
// sha256 of every vendored file. `write <tag> <commit>` records, `check` compares the vendored files with the
// lock, `upstream <judge-v2 checkout>` compares the lock with that checkout's tag.
'use strict';
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const LIB =
  process.env.JUDGE_PROTO_LIB ??
  join(__dirname, '..', '..', 'libs', 'judge-proto');
const PROTO = join(LIB, 'proto');
const LOCK = join(LIB, 'proto.lock.json');

/** Relative paths of every file under `dir`, sorted, `/`-separated. */
function filesUnder(dir, prefix = '') {
  return readdirSync(join(dir, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      return entry.isDirectory() ? filesUnder(dir, path) : [path];
    })
    .sort();
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hashes = (dir) =>
  Object.fromEntries(
    filesUnder(dir).map((path) => [
      path,
      sha256(readFileSync(join(dir, path))),
    ]),
  );

/** Paths whose hash differs or that exist on one side only. */
function differences(expected, actual) {
  const paths = [
    ...new Set([...Object.keys(expected), ...Object.keys(actual)]),
  ].sort();
  return paths.filter((path) => expected[path] !== actual[path]);
}

function fail(message, paths) {
  console.error(`${message}:\n${paths.map((path) => `  ${path}`).join('\n')}`);
  process.exit(1);
}

const readLock = () => JSON.parse(readFileSync(LOCK, 'utf8'));

function write(tag, commit) {
  const lock = { source: 'judge-v2', tag, commit, files: hashes(PROTO) };
  writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`);
}

function check() {
  const changed = differences(readLock().files, hashes(PROTO));
  if (changed.length)
    fail(
      'libs/judge-proto/proto differs from proto.lock.json (re-run npm run judge-proto:sync)',
      changed,
    );
}

function upstream(checkout) {
  const lock = readLock();
  const commit = execFileSync('git', [
    '-C',
    checkout,
    'rev-parse',
    '--verify',
    `${lock.tag}^{commit}`,
  ])
    .toString()
    .trim();
  if (commit !== lock.commit)
    fail(`tag ${lock.tag} is ${commit} in ${checkout}, the lock says`, [
      lock.commit,
    ]);
  const dir = mkdtempSync(join(tmpdir(), 'judge-proto-'));
  try {
    const archive = execFileSync('git', [
      '-C',
      checkout,
      'archive',
      '--format=tar',
      commit,
      'proto',
    ]);
    execFileSync('tar', ['-x', '-C', dir], { input: archive });
    const changed = differences(lock.files, hashes(join(dir, 'proto')));
    if (changed.length)
      fail(`the lock differs from ${lock.tag} in ${checkout}`, changed);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const [command, ...args] = process.argv.slice(2);
if (command === 'write' && args.length === 2) write(args[0], args[1]);
else if (command === 'check' && args.length === 0) check();
else if (command === 'upstream' && args.length === 1) upstream(args[0]);
else
  fail('usage', [
    'lock.js write <tag> <commit>',
    'lock.js check',
    'lock.js upstream <judge-v2 checkout>',
  ]);
