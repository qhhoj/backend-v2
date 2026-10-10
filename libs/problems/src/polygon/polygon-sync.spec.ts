import type { PolygonLink } from '@libs/database';
import { hasNewReadyPackage, syncJobOf } from './polygon-sync';

const link: PolygonLink = {
  problemId: 42,
  name: 'sum',
  owner: 'setter',
  revision: 3,
  packageId: 10,
  linkedAt: new Date(0),
  linkedBy: 'linker',
  lastSyncAt: new Date(0),
  lastSyncResult: 'ok',
  lastSyncError: null,
  lastSyncPackageId: 10,
  autoSync: true,
  options: {
    mainStatementLanguage: 'english',
    statementLanguages: { vietnamese: 'vi' },
    tutorialLanguage: null,
    ignoreZeroPointBatches: true,
    ignoreZeroPointCases: false,
    appendMainSolution: true,
    maxCases: 300,
  },
};

describe('hasNewReadyPackage', () => {
  it('wants a READY package other than the synced one', () => {
    expect(
      hasNewReadyPackage(link, { id: 11, revision: 4, state: 'READY' }),
    ).toBe(true);
    expect(
      hasNewReadyPackage(link, { id: 10, revision: 3, state: 'READY' }),
    ).toBe(false);
    expect(
      hasNewReadyPackage(link, { id: 11, revision: 4, state: 'RUNNING' }),
    ).toBe(false);
    expect(
      hasNewReadyPackage(link, { id: null, revision: null, state: 'NONE' }),
    ).toBe(false);
  });

  it('does not retry a package whose sync failed, but tries the next one', () => {
    const failed = {
      ...link,
      lastSyncResult: 'failed' as const,
      lastSyncPackageId: 11,
    };
    expect(
      hasNewReadyPackage(failed, { id: 11, revision: 4, state: 'READY' }),
    ).toBe(false);
    expect(
      hasNewReadyPackage(failed, { id: 12, revision: 5, state: 'READY' }),
    ).toBe(true);
  });
});

describe('syncJobOf', () => {
  it('is an update naming no catalog field, with the link options and the given package', () => {
    const job = syncJobOf(
      { code: 'sum', isFullMarkup: false, dataVersion: 7, polygonLink: link },
      { id: 11, revision: 4 },
      { userId: 'requester', maxCases: 9999 },
    );
    expect(job).toEqual({
      requesterId: 'requester',
      code: 'sum',
      mode: 'update',
      isFullMarkup: false,
      mainStatementLanguage: 'english',
      statementLanguages: { vietnamese: 'vi' },
      tutorialLanguage: null,
      ignoreZeroPointBatches: true,
      ignoreZeroPointCases: false,
      appendMainSolution: true,
      maxCases: 9999,
      expectedDataVersion: 7,
      polygon: {
        problemId: 42,
        name: 'sum',
        owner: 'setter',
        revision: 4,
        packageId: 11,
        purpose: 'sync',
        autoSync: true,
      },
    });
    for (const field of ['authors', 'curators', 'groupId', 'typeIds', 'points'])
      expect(job).not.toHaveProperty(field);
  });
});
