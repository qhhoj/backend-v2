// scripts/judge/parity/compare.mjs — node scripts/judge/parity/compare.mjs dmoj.json v2.json
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SUBMISSION_FIELDS = ['status', 'result', 'casePoints', 'caseTotal'];
const CASE_FIELDS = ['status', 'points', 'total', 'batch'];
const same = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 1e-6 : a === b);

function caseDifferences(label, left, right) {
  if (left.length !== right.length) return [`${label}: case count ${left.length} → ${right.length}`];
  const fields = label.endsWith('+feedback') ? [...CASE_FIELDS, 'feedback'] : CASE_FIELDS;
  return left.flatMap((a, i) =>
    fields.filter((f) => !same(a[f], right[i][f])).map((f) => `${label}: case ${a.position} ${f} ${a[f]} → ${right[i][f]}`),
  );
}

/** One line per differing field; time, memory, ids and (unless the label ends in +feedback) feedback are ignored. */
export function differences(left, right) {
  const byLabel = new Map(right.map((r) => [r.label, r]));
  const leftLabels = new Set(left.map((a) => a.label));
  const leftOnly = right.filter((b) => !leftLabels.has(b.label)).map((b) => `${b.label}: missing on the left`);
  return [...pairedDifferences(left, byLabel), ...leftOnly];
}

function pairedDifferences(left, byLabel) {
  return left.flatMap((a) => {
    const b = byLabel.get(a.label);
    if (!b) return [`${a.label}: missing on the right`];
    const top = SUBMISSION_FIELDS.filter((f) => !same(a[f], b[f])).map((f) => `${a.label}: ${f} ${a[f]} → ${b[f]}`);
    return [...top, ...caseDifferences(a.label, a.cases ?? [], b.cases ?? [])];
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [leftPath, rightPath] = process.argv.slice(2);
  const found = differences(JSON.parse(readFileSync(leftPath, 'utf8')), JSON.parse(readFileSync(rightPath, 'utf8')));
  found.forEach((line) => console.log(line));
  console.log(found.length ? `${found.length} differences` : 'parity: no differences');
  process.exit(found.length ? 1 : 0);
}
