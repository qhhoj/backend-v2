import type { ProblemData } from '@libs/database';

const IGNORED_FIELDS = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'descriptionHtml',
  'userCount',
  'acRate',
]);

/** Revision payload: every field whose JSON form changed. */
export function fieldDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { before: unknown; after: unknown }> {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)]))
    if (
      !IGNORED_FIELDS.has(key) &&
      JSON.stringify(before[key]) !== JSON.stringify(after[key])
    )
      changes[key] = { before: before[key] ?? null, after: after[key] ?? null };
  return changes;
}

/** Everything but the case rows and the derived feedback. */
const configOf = (data: ProblemData) =>
  Object.fromEntries(
    Object.entries(data).filter(
      ([field]) => field !== 'cases' && field !== 'feedback',
    ),
  );

/** Revisions keep the configuration plus a case summary (count, changed positions), never the case rows twice. */
export function dataChanges(before: ProblemData, after: ProblemData) {
  const oldCases = before.cases;
  const newCases = after.cases;
  const changes: Record<string, { before: unknown; after: unknown }> =
    fieldDiff(configOf(before), configOf(after));
  const changed = Array.from(
    { length: Math.max(oldCases.length, newCases.length) },
    (_item, index) => index,
  ).filter(
    (index) =>
      JSON.stringify(oldCases[index]) !== JSON.stringify(newCases[index]),
  );
  if (changed.length)
    changes.cases = {
      before: { count: oldCases.length },
      after: { count: newCases.length, changed },
    };
  return changes;
}
