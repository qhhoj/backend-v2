import type { PolygonLink } from '@libs/database';
import type { PolygonImportJob, PolygonSource } from '@libs/problems';

/** The fields of a successful sync attempt. */
const syncedFields = (source: PolygonSource, now: Date) => ({
  name: source.name,
  owner: source.owner,
  revision: source.revision,
  packageId: source.packageId,
  lastSyncAt: now,
  lastSyncResult: 'ok' as const,
  lastSyncError: null,
  lastSyncPackageId: source.packageId,
});

/** A first import writes the whole link, with the options every later sync re-applies. */
export function newLink(
  job: PolygonImportJob,
  source: PolygonSource,
  now: Date,
): PolygonLink {
  return {
    problemId: source.problemId,
    ...syncedFields(source, now),
    linkedAt: now,
    linkedBy: job.requesterId,
    autoSync: source.autoSync,
    options: {
      mainStatementLanguage: job.mainStatementLanguage,
      statementLanguages: job.statementLanguages,
      tutorialLanguage: job.tutorialLanguage,
      ignoreZeroPointBatches: job.ignoreZeroPointBatches,
      ignoreZeroPointCases: job.ignoreZeroPointCases,
      appendMainSolution: job.appendMainSolution,
      maxCases: job.maxCases,
    },
  };
}

/** `$set` paths of the problem update: the whole link on `link`, only the revision and sync fields on `sync` (the switch and options stay). */
export function linkChanges(
  job: PolygonImportJob,
  now: Date,
): Record<string, unknown> {
  const source = job.polygon;
  if (!source) return {};
  if (source.purpose === 'link')
    return { polygonLink: newLink(job, source, now) };
  return Object.fromEntries(
    Object.entries(syncedFields(source, now)).map(([field, value]) => [
      `polygonLink.${field}`,
      value,
    ]),
  );
}

/** What the import revision records of the link. */
export const linkSummary = (link: PolygonLink | null | undefined) =>
  link
    ? {
        problemId: link.problemId,
        revision: link.revision,
        packageId: link.packageId,
      }
    : null;

export function importComment(job: PolygonImportJob): string {
  const source = job.polygon;
  if (!source) return `Imported from a Polygon package (${job.mode})`;
  const what = source.purpose === 'sync' ? 'Synced' : 'Imported';
  return `${what} from Polygon problem ${source.problemId} (revision ${source.revision}, package ${source.packageId})`;
}
