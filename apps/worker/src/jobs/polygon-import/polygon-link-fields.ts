import type { PolygonLink } from '@libs/database';
import type { PolygonImportJob, PolygonSource } from '@libs/problems';

/** What a successful import learnt of the package beyond the job: the statement title it applied, and when. */
export interface SyncedPackage {
  title: string;
  now: Date;
}

/** The fields of a successful sync attempt. */
const syncedFields = (
  source: PolygonSource,
  { title, now }: SyncedPackage,
) => ({
  name: source.name,
  owner: source.owner,
  revision: source.revision,
  packageId: source.packageId,
  packageCreatedAt: source.packageCreatedAt
    ? new Date(source.packageCreatedAt)
    : null,
  title,
  lastSyncAt: now,
  lastSyncResult: 'ok' as const,
  lastSyncError: null,
  lastSyncErrorCode: null,
  lastSyncErrorParams: null,
  lastSyncPackageId: source.packageId,
});

/** A first import writes the whole link, with the options every later sync re-applies. */
export function newLink(
  job: PolygonImportJob,
  source: PolygonSource,
  synced: SyncedPackage,
): PolygonLink {
  return {
    problemId: source.problemId,
    ...syncedFields(source, synced),
    linkedAt: synced.now,
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
  synced: SyncedPackage,
): Record<string, unknown> {
  const source = job.polygon;
  if (!source) return {};
  if (source.purpose === 'link')
    return { polygonLink: newLink(job, source, synced) };
  return Object.fromEntries(
    Object.entries(syncedFields(source, synced)).map(([field, value]) => [
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
