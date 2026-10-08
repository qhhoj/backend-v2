/**
 * Run as `node --input-type=module -e <ENGINE_SOURCE>` from the repo root (`@dodona/dolos-lib` resolves from the working directory's `node_modules`).
 * stdin: NDJSON; the first line is `{language, kgramLength, kgramsInWindow, minSimilarity, maxPairs, maxFragments}`, every other line `{id, user, source}`.
 * stdout: one JSON line `{pairs}`; each pair has the lower submission id on the left, fragments swapped to match, capped at `maxFragments` (widest first, then in file order) so the output stays small.
 * Only files that share a fingerprint and belong to different users are compared (`getPair`); `allPairs()` would build every N x N pair object.
 */
export const ENGINE_SOURCE = String.raw`
import { createInterface } from 'node:readline';
import { Dolos, File } from '@dodona/dolos-lib';

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let config = null;
const submissions = [];
for await (const line of input) {
  if (config === null) config = JSON.parse(line);
  else submissions.push(JSON.parse(line));
}

const bySimilarity = (first, second) =>
  second.similarity - first.similarity || second.overlap - first.overlap;
const span = (range) => range.leftEnd - range.leftStart + (range.rightEnd - range.rightStart);
const swapSides = (range) => ({
  leftStart: range.rightStart,
  leftEnd: range.rightEnd,
  rightStart: range.leftStart,
  rightEnd: range.leftEnd,
});

function candidateRights(entries, left, position, submissionOf) {
  const leftUser = submissionOf.get(entries[left].file.id).user;
  const rights = new Set();
  for (const fingerprint of entries[left].shared)
    for (const file of fingerprint.files()) {
      const right = position.get(file.id);
      if (right > left && submissionOf.get(file.id).user !== leftUser) rights.add(right);
    }
  return rights;
}

function bestPairs(report, entries, submissionOf) {
  const position = new Map(entries.map((entry, index) => [entry.file.id, index]));
  const kept = [];
  let threshold = config.minSimilarity;
  for (let left = 0; left < entries.length; left++)
    for (const right of candidateRights(entries, left, position, submissionOf)) {
      const pair = report.getPair(entries[left].file, entries[right].file);
      if (pair.similarity < threshold) continue;
      kept.push({ left, right, similarity: pair.similarity, longest: pair.longest, overlap: pair.overlap });
      if (kept.length < 2 * config.maxPairs) continue;
      kept.sort(bySimilarity);
      kept.length = config.maxPairs;
      threshold = Math.max(threshold, kept[kept.length - 1].similarity);
    }
  kept.sort(bySimilarity);
  kept.length = Math.min(kept.length, config.maxPairs);
  return kept;
}

function fragmentsOf(report, leftFile, rightFile, isSwapped) {
  const ranges = report.getPair(leftFile, rightFile).buildFragments().map((fragment) => ({
    leftStart: fragment.leftSelection.startRow + 1,
    leftEnd: fragment.leftSelection.endRow + 1,
    rightStart: fragment.rightSelection.startRow + 1,
    rightEnd: fragment.rightSelection.endRow + 1,
  }));
  return (isSwapped ? ranges.map(swapSides) : ranges)
    .sort((first, second) => span(second) - span(first))
    .slice(0, config.maxFragments)
    .sort((first, second) => first.leftStart - second.leftStart);
}

function describe(report, entries, submissionOf, item) {
  const leftFile = entries[item.left].file;
  const rightFile = entries[item.right].file;
  const leftId = submissionOf.get(leftFile.id).id;
  const rightId = submissionOf.get(rightFile.id).id;
  const isSwapped = leftId > rightId;
  return {
    leftId: isSwapped ? rightId : leftId,
    rightId: isSwapped ? leftId : rightId,
    similarity: item.similarity,
    longest: item.longest,
    overlap: item.overlap,
    fragments: fragmentsOf(report, leftFile, rightFile, isSwapped),
  };
}

async function compare() {
  if (config === null || submissions.length < 2) return [];
  const files = submissions.map((submission) => new File(submission.id + '.txt', submission.source));
  const report = await new Dolos({
    language: config.language,
    kgramLength: config.kgramLength,
    kgramsInWindow: config.kgramsInWindow,
  }).analyze(files);
  const entries = report.index.entries();
  const submissionOf = new Map(files.map((file, index) => [file.id, submissions[index]]));
  return bestPairs(report, entries, submissionOf).map((item) => describe(report, entries, submissionOf, item));
}

process.stdout.write(JSON.stringify({ pairs: await compare() }) + '\n');
`;
