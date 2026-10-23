// Read-only snapshot of one problem's submissions for the migration gate.
//   QHHOJ_MONGO_URL=mongodb://... node gate-snapshot.mjs --problem <code> --out <file>
// The URL comes from the environment (or --mongo-url), never from the repo. The export holds contestant
// source: write it to a private directory, never into a repository.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArguments } from './gate-args.mjs';
import { MongoClient } from 'mongodb';

const SOURCE_BATCH = 500;
const CASE_FIELDS = ['position', 'status', 'time', 'memory', 'points', 'total'];
const EN_CASE_INSENSITIVE = { locale: 'en', strength: 2 };
/** The only collection operations the snapshot may use. */
const READ_OPERATIONS = ['find', 'findOne'];

/** Wraps a database so that only reads are reachable; any other operation is a TypeError. */
export function readOnly(db) {
  return {
    collection(name) {
      const collection = db.collection(name);
      return Object.fromEntries(
        READ_OPERATIONS.map((op) => [op, collection[op].bind(collection)]),
      );
    },
  };
}

/** BSON UUID (binary subtype 4) to its dashed string. */
const uuidText = (value) => value.toUUID().toHexString();

const pick = (object, fields) =>
  Object.fromEntries(fields.map((field) => [field, object[field] ?? null]));

const rowOf = (submission, languageKeys, sources) => ({
  id: uuidText(submission._id),
  language: languageKeys.get(uuidText(submission.language)) ?? null,
  result: submission.result ?? null,
  points: submission.points ?? null,
  casePoints: submission.casePoints ?? 0,
  caseTotal: submission.caseTotal ?? 0,
  judgedDataVersion: submission.judgedDataVersion ?? null,
  cases: (submission.cases ?? []).map((c) => pick(c, CASE_FIELDS)),
  source: sources.get(uuidText(submission._id)) ?? null,
});

async function languageKeysOf(db) {
  const languages = await db.collection('languages').find({}).toArray();
  return new Map(languages.map((l) => [uuidText(l._id), l.key]));
}

async function sourcesOf(db, submissions) {
  const found = await db
    .collection('submissionSources')
    .find({ _id: { $in: submissions.map((s) => s._id) } })
    .toArray();
  return new Map(found.map((s) => [uuidText(s._id), s.source]));
}

/** Rows of every submission of the problem (all users, languages and results), ordered by id. */
async function* submissionRows(db, problemId) {
  const languageKeys = await languageKeysOf(db);
  const cursor = db
    .collection('submissions')
    .find({ problem: problemId })
    .sort({ _id: 1 })
    .project({ cases: 1, language: 1, result: 1, points: 1, casePoints: 1, caseTotal: 1, judgedDataVersion: 1 });
  let batch = [];
  for await (const submission of cursor) {
    batch.push(submission);
    if (batch.length < SOURCE_BATCH) continue;
    const sources = await sourcesOf(db, batch);
    for (const s of batch) yield rowOf(s, languageKeys, sources);
    batch = [];
  }
  const sources = await sourcesOf(db, batch);
  for (const s of batch) yield rowOf(s, languageKeys, sources);
}

/** The snapshot document of a problem code (case-insensitive, as the site resolves codes). */
export async function snapshotProblem(db, code, now = new Date()) {
  const problem = await db
    .collection('problems')
    .findOne({ code }, { collation: EN_CASE_INSENSITIVE });
  if (!problem) throw new Error(`no problem with code ${code}`);
  const rows = [];
  for await (const row of submissionRows(db, problem._id)) rows.push(row);
  return {
    exportedAt: now.toISOString(),
    problem: problem.code,
    dataVersion: problem.dataVersion ?? 0,
    rows,
  };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const url = args['mongo-url'] ?? process.env.QHHOJ_MONGO_URL;
  if (!url || !args.problem || !args.out) {
    throw new Error('usage: QHHOJ_MONGO_URL=... gate-snapshot.mjs --problem <code> --out <file>');
  }
  const client = new MongoClient(url, { readPreference: 'secondaryPreferred' });
  try {
    await client.connect();
    const snapshot = await snapshotProblem(readOnly(client.db()), args.problem);
    writeFileSync(args.out, JSON.stringify(snapshot), { mode: 0o600 });
    console.log(`${snapshot.rows.length} submissions of ${snapshot.problem} (dataVersion ${snapshot.dataVersion}) -> ${args.out}`);
  } finally {
    await client.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
