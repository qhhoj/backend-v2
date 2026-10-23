// Compares two gate snapshots: node gate-compare.mjs --control <file> --candidate <file> [--stored <file>] [--json <file>]
// control is the reference (the unsplit local pass), candidate the pass under test; --stored (the production
// snapshot) adds the pre-existing list, control against stored. Exit 1: a worsened row. Exit 2: no worsened
// row, but "other", missing or slowdown rows need a decision. Improved rows are accepted without review.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArguments, writePrivate } from './gate-args.mjs';
import { classify, preExisting } from './gate-classify.mjs';

const MAX_FIELDS_SHOWN = 6;

const line = (row) => {
  const hint = row.suggestion ? `  [${row.suggestion}${row.hints.exploit.length ? ': ' + row.hints.exploit.join(',') : ''}]` : '';
  const shown = row.fields.slice(0, MAX_FIELDS_SHOWN).join('; ');
  const more = row.fields.length > MAX_FIELDS_SHOWN ? ` (+${row.fields.length - MAX_FIELDS_SHOWN} more)` : '';
  return `  ${row.id} ${row.language}: ${shown}${more}${hint}`;
};

const section = (title, rows, render = line) =>
  rows.length === 0 ? [] : [`${title} (${rows.length})`, ...rows.map(render)];

const slowdownLine = (row) => `  ${row.id} ${row.language}: slower cases ${row.slowdownCases.join(',')}`;

const missingLine = (row) => `  ${row.id} ${row.language}: missing from ${row.side}`;

export function totalsLine(report) {
  return (
    `unchanged ${report.unchanged}, timing-only ${report.timingOnly.length}, improved ${report.improved.length}, ` +
    `worsened ${report.worsened.length}, other ${report.other.length}, missing ${report.missing.length}, ` +
    `tle-flips ${report.tleFlips.length}, slowdowns ${report.slowdowns.length}`
  );
}

/** Human report: totals first, then the rows that need attention, worst first. */
export function format(report, title) {
  return [
    `${title}: ${totalsLine(report)}`,
    ...section('WORSENED (stops the flip)', report.worsened),
    ...section('OTHER (decide)', report.other),
    ...section('MISSING', report.missing, missingLine),
    ...section('SLOWDOWNS (decide)', report.slowdowns, slowdownLine),
    ...section('TLE flips', report.tleFlips),
    ...section('improved (accepted)', report.improved),
    ...section('timing-only', report.timingOnly),
  ].join('\n');
}

export function exitCode(report) {
  if (report.worsened.length > 0) return 1;
  return report.other.length + report.missing.length + report.slowdowns.length > 0 ? 2 : 0;
}

const rowsOf = (file) => JSON.parse(readFileSync(file, 'utf8')).rows;

function main() {
  const args = parseArguments(process.argv.slice(2));
  if (!args.control || !args.candidate) {
    throw new Error('usage: gate-compare.mjs --control <file> --candidate <file> [--stored <file>] [--json <file>]');
  }
  const control = rowsOf(args.control);
  const sections = [];
  const reports = {};
  if (args.stored) {
    reports.preExisting = preExisting(rowsOf(args.stored), control);
    sections.push(format(reports.preExisting, 'pre-existing (control vs stored)'));
  }
  reports.candidate = classify(control, rowsOf(args.candidate));
  sections.push(format(reports.candidate, 'candidate vs control'));
  console.log(sections.join('\n\n'));
  if (args.json) writePrivate(args.json, JSON.stringify(reports, null, 1));
  process.exitCode = exitCode(reports.candidate);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 3;
  }
}
