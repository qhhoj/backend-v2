import { Injectable } from '@nestjs/common';
import { stat } from 'node:fs/promises';
import type { Principal } from '@libs/auth';
import { uuidStr } from '@libs/database';
import type { Problem } from '@libs/database';
import { ProblemDataFilesService } from '@libs/problems';
import { chargedOrganization } from '../../organizations/quota/quota-charge';
import { QuotaService } from '../../organizations/quota/quota.service';
import { ProblemsRepository } from '../core/problems.repository';
import type { ProblemDocument } from '../core/problems.repository';
import { problemChargeSubject } from './problem-charge-subject';

/** The storage meter for problem files: what an organization already holds (`dataBytes` plus the PDF statement and material bytes) against what a write adds. */
@Injectable()
export class ProblemStorageQuota {
  constructor(
    private readonly quota: QuotaService,
    private readonly problems: ProblemsRepository,
    private readonly dataFiles: ProblemDataFilesService,
  ) {}

  /** The organization an upload to `problem` is charged to; null (public problem, superuser) is not metered. */
  organizationOf(
    principal: Pick<Principal, 'isSuperuser'>,
    problem: ProblemDocument,
  ): string | null {
    return chargedOrganization(principal, problemChargeSubject(problem));
  }

  /** An edit that changes the organization a problem is charged to (a move) must fit the new one's storage with every byte the problem holds. */
  async assertMoveFits(
    principal: Pick<Principal, 'isSuperuser'>,
    problem: ProblemDocument,
    fields: Partial<Problem>,
  ): Promise<void> {
    const before = this.organizationOf(principal, problem);
    const after = chargedOrganization(principal, {
      isOrganizationPrivate:
        fields.isOrganizationPrivate ?? problem.isOrganizationPrivate,
      organizations: (fields.organizations ?? problem.organizations).map(
        uuidStr,
      ),
    });
    if (after === null || after === before) return;
    await this.assertFits(after, {
      addedBytes:
        problem.dataBytes + problem.pdfStatementBytes + problem.materialBytes,
    });
  }

  /** `addedBytes` is the growth: the new bytes minus the bytes the write replaces. */
  async assertFits(
    organizationId: string | null,
    write: { addedBytes: number },
  ): Promise<void> {
    if (organizationId === null) return;
    await this.quota.assertStorage(organizationId, {
      usedBytes: await this.problems.sumStoredBytes(organizationId),
      addedBytes: write.addedBytes,
    });
  }

  /** After a file write: warns the organization's admins once it passes 80% of storage. Never throws (see `QuotaService.afterStorageWrite`). */
  async afterWrite(organizationId: string | null): Promise<void> {
    if (organizationId === null) return;
    await this.quota.afterStorageWrite(organizationId, () =>
      this.problems.sumStoredBytes(organizationId),
    );
  }

  /** Size of the file an upload will replace (0 when there is none or it is gone). */
  async replacedBytes(
    code: string,
    previousName: string | null,
  ): Promise<number> {
    if (!previousName) return 0;
    try {
      return (await stat(this.dataFiles.pathOf(code, previousName))).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw error;
    }
  }
}
