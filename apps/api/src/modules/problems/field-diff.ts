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
