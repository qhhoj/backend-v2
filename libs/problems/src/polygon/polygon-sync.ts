import type { Permission } from '@libs/auth';
import type { PolygonLink, PolygonSyncTrigger } from '@libs/database';
import type { PolygonImportJob } from '../queues';
import type { LatestPackage, ReadyPackage } from './polygon-types';

/** Syncing a linked problem (now or automatically) and changing its link, on top of write access to its test data; the api gates the routes with it and the worker re-checks it on every sync. */
export const POLYGON_SYNC_PERMISSION: Permission = 'judge.sync_polygon_problem';

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
 * allowed languages stay; statement, tests, checker and limits come from the package with the link's options, its
 * testcase limit included (whoever starts the sync).
 */
export function syncJobOf(
  problem: LinkedProblem,
  latest: Pick<ReadyPackage, 'id' | 'revision' | 'type' | 'createdAt'>,
  requester: { userId: string; trigger: PolygonSyncTrigger },
): PolygonImportJob {
  const link = problem.polygonLink;
  return {
    requesterId: requester.userId,
    code: problem.code,
    mode: 'update',
    isFullMarkup: problem.isFullMarkup,
    ...link.options,
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
