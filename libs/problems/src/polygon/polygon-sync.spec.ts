import type { PolygonLink } from '@libs/database';
import { hasNewReadyPackage, syncJobOf } from './polygon-sync';
import type { LatestPackage } from './polygon-types';

const link: PolygonLink = {
  problemId: 42,
  name: 'sum',
  owner: 'setter',
  revision: 3,
  packageId: 10,
  packageCreatedAt: null,
  title: 'Sum',
  importedSettings: null,
  linkedAt: new Date(0),
  linkedBy: 'linker',
  lastSyncAt: new Date(0),
  lastSyncResult: 'ok',
  lastSyncError: null,
  lastSyncErrorCode: null,
  lastSyncErrorParams: null,
  lastSyncPackageId: 10,
  autoSync: true,
  options: {
    mainStatementLanguage: 'english',
    statementLanguages: { vietnamese: 'vi' },
    tutorialLanguage: null,
    ignoreZeroPointBatches: true,
    ignoreZeroPointCases: false,
    appendMainSolution: true,
    importTutorial: true,
    maxCases: 300,
  },
};

const latest = (
  id: number | null,
  revision: number | null,
  state: LatestPackage['state'],
  type: LatestPackage['type'] = state === 'READY' ? 'full' : null,
): LatestPackage => ({ id, revision, state, type, createdAt: null });

describe('hasNewReadyPackage', () => {
  it('wants a READY package other than the synced one', () => {
    expect(hasNewReadyPackage(link, latest(11, 4, 'READY'))).toBe(true);
    expect(hasNewReadyPackage(link, latest(11, 4, 'READY', 'standard'))).toBe(
      true,
    );
    expect(hasNewReadyPackage(link, latest(10, 3, 'READY'))).toBe(false);
    expect(hasNewReadyPackage(link, latest(11, 4, 'RUNNING'))).toBe(false);
    expect(hasNewReadyPackage(link, latest(null, null, 'NONE'))).toBe(false);
  });

  it('does not retry a package whose sync failed, but tries the next one', () => {
    const failed = {
      ...link,
      lastSyncResult: 'failed' as const,
      lastSyncPackageId: 11,
    };
    expect(hasNewReadyPackage(failed, latest(11, 4, 'READY'))).toBe(false);
    expect(hasNewReadyPackage(failed, latest(12, 5, 'READY'))).toBe(true);
  });
});

describe('syncJobOf', () => {
  it('is an update naming no catalog field, with the link options (its testcase limit too) and the given package', () => {
    const job = syncJobOf(
      { code: 'sum', isFullMarkup: false, dataVersion: 7, polygonLink: link },
      {
        id: 11,
        revision: 4,
        type: 'standard',
        createdAt: '2026-10-01T00:00:00.000Z',
      },
      { userId: 'requester', trigger: 'auto' },
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
      importTutorial: true,
      maxCases: 300,
      expectedDataVersion: 7,
      polygon: {
        problemId: 42,
        name: 'sum',
        owner: 'setter',
        revision: 4,
        packageId: 11,
        packageType: 'standard',
        packageCreatedAt: '2026-10-01T00:00:00.000Z',
        purpose: 'sync',
        autoSync: true,
        trigger: 'auto',
      },
    });
    for (const field of ['authors', 'curators', 'groupId', 'typeIds', 'points'])
      expect(job).not.toHaveProperty(field);
  });
});
