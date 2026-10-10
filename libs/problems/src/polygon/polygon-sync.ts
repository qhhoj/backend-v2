import type { PolygonLink } from '@libs/database';
import type { PolygonImportJob } from '../queues';
import type { LatestPackage } from './polygon-types';

/** The problem fields a sync job is built from. */
export interface LinkedProblem {
  code: string;
  isFullMarkup: boolean;
  dataVersion: number;
  polygonLink: PolygonLink;
}

/** A READY package other than the synced one; a package whose sync already failed is not retried automatically. */
export function hasNewReadyPackage(
  link: PolygonLink,
  latest: LatestPackage,
): latest is LatestPackage & { id: number; revision: number } {
  return (
    latest.state === 'READY' &&
    latest.id !== null &&
    latest.id !== link.packageId &&
    !(link.lastSyncResult === 'failed' && link.lastSyncPackageId === latest.id)
  );
}

/**
 * A sync is an update import that names no catalog field, so code, points, group, types, authors, curators and
 * allowed languages stay; statement, tests, checker and limits come from the package with the link's options.
 */
export function syncJobOf(
  problem: LinkedProblem,
  latest: { id: number; revision: number },
  requester: { userId: string; maxCases: number },
): PolygonImportJob {
  const link = problem.polygonLink;
  return {
    requesterId: requester.userId,
    code: problem.code,
    mode: 'update',
    isFullMarkup: problem.isFullMarkup,
    ...link.options,
    maxCases: requester.maxCases,
    expectedDataVersion: problem.dataVersion ?? 0,
    polygon: {
      problemId: link.problemId,
      name: link.name,
      owner: link.owner,
      revision: latest.revision,
      packageId: latest.id,
      purpose: 'sync',
      autoSync: link.autoSync,
    },
  };
}
