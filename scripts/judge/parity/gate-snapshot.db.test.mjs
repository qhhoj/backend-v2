// Needs a local mongod via mongodb-memory-server (CI does not run it). run: node --test scripts/judge/parity/gate-snapshot.db.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { MongoClient, UUID } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { readOnly, snapshotProblem } from './gate-snapshot.mjs';

let server;
let client;
let db;
const problemId = new UUID();
const languageId = new UUID();
const aSubmission = (overrides) => ({
  _id: new UUID(), problem: problemId, language: languageId, user: new UUID(), result: 'AC', points: 10,
  casePoints: 10, caseTotal: 10, judgedDataVersion: 2, status: 'D',
  cases: [{ position: 1, status: 'AC', time: 0.5, memory: 100, points: 10, total: 10, feedback: 'secret' }],
  ...overrides,
});
const submissions = [aSubmission({}), aSubmission({ result: 'WA', points: 0, casePoints: 0 }), aSubmission({ result: 'CE', points: null, cases: [] })];

before(async () => {
  server = await MongoMemoryServer.create();
  client = await MongoClient.connect(server.getUri());
  db = client.db('gate');
  await db.collection('problems').insertMany([
    { _id: problemId, code: 'Demo', dataVersion: 7 },
    { _id: new UUID(), code: 'other', dataVersion: 1 },
  ]);
  await db.collection('languages').insertOne({ _id: languageId, key: 'CPP17' });
  await db.collection('submissions').insertMany([...submissions, aSubmission({ problem: new UUID() })]);
  await db.collection('submissionSources').insertMany(
    submissions.slice(0, 2).map((s, i) => ({ _id: s._id, source: `int v${i};` })),
  );
});
after(async () => {
  await client?.close();
  await server?.stop();
});

const fingerprint = async () =>
  JSON.stringify(
    await Promise.all(
      ['problems', 'languages', 'submissions', 'submissionSources'].map((name) => db.collection(name).find({}).toArray()),
    ),
  );

test('snapshot holds every submission of the problem with gate fields, language key and source', async () => {
  const snapshot = await snapshotProblem(readOnly(db), 'demo');
  assert.equal(snapshot.problem, 'Demo');
  assert.equal(snapshot.dataVersion, 7);
  assert.equal(snapshot.rows.length, 3);
  const byResult = Object.fromEntries(snapshot.rows.map((r) => [r.result, r]));
  assert.equal(byResult.AC.language, 'CPP17');
  assert.equal(byResult.AC.judgedDataVersion, 2);
  assert.deepEqual(Object.keys(byResult.AC.cases[0]).sort(), ['memory', 'points', 'position', 'status', 'time', 'total']);
  assert.equal(byResult.AC.source?.startsWith('int v'), true);
  assert.equal(byResult.CE.source, null);
  assert.match(byResult.AC.id, /^[0-9a-f]{8}-[0-9a-f]{4}-/);
  assert.equal('user' in byResult.AC, false);
});

test('an unknown problem code is an error', async () => {
  await assert.rejects(snapshotProblem(readOnly(db), 'nope'), /no problem with code nope/);
});

test('the snapshot leaves the database untouched and exposes no write operation', async () => {
  const before = await fingerprint();
  await snapshotProblem(readOnly(db), 'Demo');
  assert.equal(await fingerprint(), before);
  const collection = readOnly(db).collection('submissions');
  for (const op of ['insertOne', 'updateMany', 'deleteMany', 'drop', 'findOneAndUpdate', 'bulkWrite']) {
    assert.equal(collection[op], undefined, op);
  }
});

test('snapshot then compare end to end: a rejudged WA to AC is improved, exit 0', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'));
  const snapshot = await snapshotProblem(readOnly(db), 'Demo');
  const candidate = structuredClone(snapshot);
  const wa = candidate.rows.find((r) => r.result === 'WA');
  Object.assign(wa, { result: 'AC', points: 10, casePoints: 10 });
  wa.cases = structuredClone(snapshot.rows.find((r) => r.result === 'AC').cases);
  writeFileSync(join(dir, 'a.json'), JSON.stringify(snapshot));
  writeFileSync(join(dir, 'b.json'), JSON.stringify(candidate));
  const script = new URL('./gate-compare.mjs', import.meta.url).pathname;
  const run = spawnSync('node', [script, '--control', join(dir, 'a.json'), '--candidate', join(dir, 'b.json'), '--stored', join(dir, 'a.json')]);
  assert.equal(run.status, 0, run.stderr.toString());
  assert.match(run.stdout.toString(), /candidate vs control: unchanged 2, timing-only 0, improved 1, worsened 0/);
  writeFileSync(join(dir, 'c.json'), JSON.stringify({ rows: [] }));
  const worse = spawnSync('node', [script, '--control', join(dir, 'b.json'), '--candidate', join(dir, 'a.json')]);
  assert.equal(worse.status, 1);
  assert.match(worse.stdout.toString(), /WORSENED/);
  const gone = spawnSync('node', [script, '--control', join(dir, 'a.json'), '--candidate', join(dir, 'c.json')]);
  assert.equal(gone.status, 2);
  assert.match(gone.stdout.toString(), /missing from candidate/);
});
