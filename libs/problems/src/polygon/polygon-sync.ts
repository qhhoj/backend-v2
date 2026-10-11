import type { PolygonLink, PolygonSyncTrigger } from '@libs/database';
import type { PolygonImportJob } from '../queues';
import type { LatestPackage, ReadyPackage } from './polygon-types';

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
): latest is ReadyPackage {
  return (
    latest.state === 'READY' &&
    latest.id !== null &&
    latest.type !== null &&
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
  latest: Pick<ReadyPackage, 'id' | 'revision' | 'type' | 'createdAt'>,
  requester: { userId: string; maxCases: number; trigger: PolygonSyncTrigger },
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
      packageType: latest.type,
      packageCreatedAt: latest.createdAt,
      purpose: 'sync',
      autoSync: link.autoSync,
      trigger: requester.trigger,
    },
  };
}
