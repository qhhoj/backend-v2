// scripts/judge/parity/submit-all.mjs --manifest $RUN/parity-manifest.json --out <file>
// Reads E2E_REAL_API, SITE_URL and E2E_ADMIN_PASSWORD from the environment (source $RUN/env first).
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { manifest: { type: 'string' }, out: { type: 'string' } } });
const API = `${process.env.E2E_REAL_API}/api/internal`;
const ORIGIN = process.env.SITE_URL;
const FINAL_WAIT_MS = 120_000;
const cookies = new Map();
let csrf = '';

function keepCookies(response) {
  for (const line of response.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(';');
    const at = pair.indexOf('=');
    cookies.set(pair.slice(0, at), pair.slice(at + 1));
  }
}

async function send(method, path, { body, headers = {} } = {}) {
  const cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { origin: ORIGIN, cookie, 'x-csrf-token': csrf, ...headers },
    body,
  });
  keepCookies(response);
  const json = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(new Error(`${method} ${path}: ${response.status} ${JSON.stringify(json)}`), { status: response.status });
  return json.data;
}

const call = (method, path, body) =>
  send(method, path, body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

/** Multipart file submit (OUTPUT zips): fetch sets the multipart content type itself. */
function submitFile(run, languageId) {
  const form = new FormData();
  form.append('language', languageId);
  const name = `${run.label.replaceAll('/', '_')}.zip`;
  form.append('file', new Blob([Buffer.from(run.fileBase64, 'base64')], { type: 'application/zip' }), name);
  return send('POST', `/problems/${run.problem}/submit/file`, { body: form });
}

async function login() {
  const session = await call('POST', '/auth/login', { username: 'e2e_admin', password: process.env.E2E_ADMIN_PASSWORD });
  csrf = session.csrfToken;
}

const FINAL = ['CE', 'IE', 'AB'];
const done = (s) => s.status === 'D' || FINAL.includes(s.status) || FINAL.includes(s.result);

/** The final state, or null when none arrived in FINAL_WAIT_MS. */
async function waitFinal(id) {
  const deadline = Date.now() + FINAL_WAIT_MS;
  while (Date.now() < deadline) {
    const state = await call('GET', `/submissions/${id}`);
    if (done(state)) return state;
    await sleep(500);
  }
  return null;
}

const caseShape = ({ position, status, points, total, batch, feedback }) => ({
  position, status, points, total, batch, feedback: feedback ?? '',
});

const shape = (label, s) =>
  s === null
    ? { label, status: 'TIMEOUT', result: null, casePoints: null, caseTotal: null, cases: [] }
    : { label, status: s.status, result: s.result, casePoints: s.casePoints, caseTotal: s.caseTotal, cases: (s.cases ?? []).map(caseShape) };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function submitOnce(run, languageId) {
  if (run.fileBase64) return submitFile(run, languageId);
  return call('POST', `/problems/${run.problem}/submit`, { language: languageId, source: run.source });
}

/** The api allows 20 submits a minute per user: a 429 waits and retries. */
async function submitRun(run, languageId) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await submitOnce(run, languageId);
    } catch (error) {
      if (error.status !== 429 || attempt === 10) throw error;
      await sleep(10_000);
    }
  }
}

const manifest = JSON.parse(readFileSync(values.manifest, 'utf8'));
await login();
const results = [];
let joined = null;
try {
  for (const run of manifest.runs) {
    if (run.contest && joined !== run.contest) {
      await call('POST', `/contests/${run.contest}/join`, {});
      joined = run.contest;
    }
    const created = await submitRun(run, manifest.languages[run.language]);
    results.push(shape(run.label, await waitFinal(created.id)));
    console.log(`${run.label}: ${results.at(-1).result ?? results.at(-1).status}`);
  }
} finally {
  if (joined) await call('POST', `/contests/${joined}/leave`, {});
  writeFileSync(values.out, JSON.stringify(results, null, 2));
}
