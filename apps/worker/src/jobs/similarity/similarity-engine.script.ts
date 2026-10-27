/**
 * Run as `node --input-type=module -e <ENGINE_SOURCE>` (`dolosEntry` is the library's file URL, resolved by the parent, so the working directory does not matter).
 * stdin: NDJSON; the first line is `{dolosEntry, timeoutMs, language, kgramLength, kgramsInWindow, minSimilarity, maxPairs, maxFragments}`, every other line `{id, user, source}`.
 * stdout: one JSON line `{pairs, droppedByCap}`; each pair has the lower submission id on the left, fragments swapped to match, capped at `maxFragments` (widest first, then in file order) so the output stays small.
 * Only files that share a fingerprint and belong to different users are compared (`getPair`); `allPairs()` would build every N x N pair object.
 * Each two users get at most one pair, their strongest, before the `maxPairs` cap; `droppedByCap` counts the user pairs at or above `minSimilarity` the cap left out.
 */
export const ENGINE_SOURCE = String.raw`
import { createInterface } from 'node:readline';

// The IPC channel only exists to report the parent's death through 'disconnect'; it must not keep the process alive.
process.channel?.unref();
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let config = null;
const submissions = [];

// The worker may die without cleaning up (SIGKILL, OOM kill): never outlive it or the deadline.
function exitWithParentOrDeadline(timeoutMs) {
  process.on('disconnect', () => process.exit(1));
  setTimeout(() => process.exit(1), timeoutMs).unref();
}

for await (const line of input) {
  if (config !== null) submissions.push(JSON.parse(line));
  else {
    config = JSON.parse(line);
    exitWithParentOrDeadline(config.timeoutMs);
  }
}

const { Dolos, File } = await import(config.dolosEntry);

const bySimilarity = (first, second) =>
  second.similarity - first.similarity || second.overlap - first.overlap;
const span = (range) => range.leftEnd - range.leftStart + (range.rightEnd - range.rightStart);
const swapSides = (range) => ({
  leftStart: range.rightStart,
  leftEnd: range.rightEnd,
  rightStart: range.leftStart,
  rightEnd: range.leftEnd,
});

function candidateRights(entries, left, position, userAt) {
  const rights = new Set();
  for (const fingerprint of entries[left].shared)
    for (const file of fingerprint.files()) {
      const right = position.get(file.id);
      if (right > left && userAt(right) !== userAt(left)) rights.add(right);
    }
  return rights;
}

function candidateOf(report, entries, left, right) {
  const pair = report.getPair(entries[left].file, entries[right].file);
  return { left, right, similarity: pair.similarity, longest: pair.longest, overlap: pair.overlap };
}

// Entries are sorted by user, so every pair of two users is met while the earlier user's files are on the left:
// the strongest pair of each user pair is final once that user's files are done.
function* strongestPerUserPair(report, entries, userAt) {
  const position = new Map(entries.map((entry, index) => [entry.file.id, index]));
  let left = 0;
  while (left < entries.length) {
    const user = userAt(left);
    const strongestByRightUser = new Map();
    for (; left < entries.length && userAt(left) === user; left++)
      for (const right of candidateRights(entries, left, position, userAt)) {
        const candidate = candidateOf(report, entries, left, right);
        const strongest = strongestByRightUser.get(userAt(right));
        if (candidate.similarity < config.minSimilarity) continue;
        if (!strongest || bySimilarity(candidate, strongest) < 0) strongestByRightUser.set(userAt(right), candidate);
      }
    yield* strongestByRightUser.values();
  }
}

function strongestCapped(candidates) {
  const kept = [];
  let offered = 0;
  for (const candidate of candidates) {
    offered++;
    kept.push(candidate);
    // Pruning at twice the limit keeps memory bounded at O(maxPairs) while sorting only once per maxPairs insertions.
    if (kept.length < 2 * config.maxPairs) continue;
    kept.sort(bySimilarity);
    kept.length = config.maxPairs;
  }
  kept.sort(bySimilarity);
  kept.length = Math.min(kept.length, config.maxPairs);
  return { kept, droppedByCap: offered - kept.length };
}

const byUser = (submissionOf) => (first, second) => {
  const firstUser = submissionOf.get(first.file.id).user;
  const secondUser = submissionOf.get(second.file.id).user;
  return firstUser < secondUser ? -1 : firstUser > secondUser ? 1 : 0;
};

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

function toEnginePair(report, entries, submissionOf, candidate) {
  const leftFile = entries[candidate.left].file;
  const rightFile = entries[candidate.right].file;
  const leftId = submissionOf.get(leftFile.id).id;
  const rightId = submissionOf.get(rightFile.id).id;
  const isSwapped = leftId > rightId;
  return {
    leftId: isSwapped ? rightId : leftId,
    rightId: isSwapped ? leftId : rightId,
    similarity: candidate.similarity,
    longest: candidate.longest,
    overlap: candidate.overlap,
    fragments: fragmentsOf(report, leftFile, rightFile, isSwapped),
  };
}

async function compare() {
  if (config === null || submissions.length < 2) return { pairs: [], droppedByCap: 0 };
  const files = submissions.map((submission) => new File(submission.id + '.txt', submission.source));
  const report = await new Dolos({
    language: config.language,
    kgramLength: config.kgramLength,
    kgramsInWindow: config.kgramsInWindow,
  }).analyze(files);
  const submissionOf = new Map(files.map((file, index) => [file.id, submissions[index]]));
  const entries = report.index.entries().sort(byUser(submissionOf));
  const userAt = (index) => submissionOf.get(entries[index].file.id).user;
  const { kept, droppedByCap } = strongestCapped(strongestPerUserPair(report, entries, userAt));
  return { pairs: kept.map((candidate) => toEnginePair(report, entries, submissionOf, candidate)), droppedByCap };
}

process.stdout.write(JSON.stringify(await compare()) + '\n');
`;
