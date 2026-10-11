import { Injectable } from '@nestjs/common';
import { stat } from 'node:fs/promises';
import type { PolygonSyncStep } from '@libs/database';
import { QuotaLedger, quotaRefusalOf } from '@libs/problems';
import type { PolygonImportJob } from '@libs/problems';
import { PolygonImportError } from './polygon-import.error';

/** The organization quota of a create the api queued: the storage check of a package downloaded here, and the refund of the credits the api spent when the import fails. */
@Injectable()
export class ImportQuota {
  constructor(private readonly ledger: QuotaLedger) {}

  /** The api checked an uploaded package; a package downloaded from Polygon is checked here, once its size is known. The refusal is written for the requester. */
  async assertPackageFits(
    job: PolygonImportJob,
    packagePath: string,
  ): Promise<void> {
    const organizationId = job.meteredOrganizationId;
    if (job.mode !== 'create' || !organizationId) return;
    const write = {
      usedBytes: await this.ledger.usedStorageBytes(organizationId),
      addedBytes: (await stat(packagePath)).size,
    };
    try {
      await this.ledger.assertStorage(organizationId, write);
    } catch (error) {
      const refusal = quotaRefusalOf(error);
      if (!refusal) throw error;
      throw new PolygonImportError(
        `the organization's storage is full: ${refusal.used} of ${refusal.limit} bytes used, the package needs ${refusal.needed} more`,
      );
    }
  }

  /** The credits of a failed create go back once (keyed by the job), unless the failure came after the write committed (`finishing`): the problem exists and keeps them spent. */
  async refundFailed(
    jobId: string,
    job: PolygonImportJob,
    step: PolygonSyncStep,
  ): Promise<void> {
    if (!job.charge || step === 'finishing') return;
    await this.ledger.refundOnce(`polygon-import:${jobId}`, job.charge);
  }
}
