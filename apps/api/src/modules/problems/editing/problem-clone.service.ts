import { Injectable } from '@nestjs/common';
import type { AuthContext } from '@libs/auth';
import { StorageService } from '@libs/common';
import { BASE_STATEMENT_LANGUAGE, newId, uuidStr } from '@libs/database';
import type { Problem } from '@libs/database';
import { fieldDiff, ProblemDataFilesService } from '@libs/problems';
import { chargedOrganization } from '../../organizations/quota/quota-charge';
import { QuotaService } from '../../organizations/quota/quota.service';
import { CloneProblemDto } from './dto/clone.dto';
import { ProblemDetailResponse } from '../core/dto/problem-detail.response';
import { ProblemEditPolicyService } from './problem-edit-policy.service';
import {
  assertCodeAvailable,
  withCodeTaken,
  withoutRenderedHtml,
} from './problem-edit-fields';
import { ProblemsRepository } from '../core/problems.repository';
import { ProblemsService } from '../core/problems.service';
import { RevisionsRepository } from '../core/revisions.repository';

/** Never carried over by a clone: identity, timestamps, people, statement translations, editorial, mirror, Polygon and external judge links, and test data. */
export const CLONE_RESET_FIELDS = [
  'id',
  'createdAt',
  'updatedAt',
  'code',
  'isPublic',
  'date',
  'userCount',
  'acRate',
  'data',
  'dataVersion',
  'dataBytes',
  'sourceChecks',
  'deletedAt',
  'deletedBy',
  'purgeStartedAt',
  'purgedAt',
  'authors',
  'curators',
  'testers',
  'bannedUsers',
  'suggester',
  'translations',
  'solution',
  'mirrorOf',
  'mirrorRoot',
  'polygonLink',
  'externalJudge',
];
/** Copied by value (the material is then pointed at the clone's own file copy); together with CLONE_RESET_FIELDS this must cover every schema path. */
export const CLONE_COPIED_FIELDS = [
  'name',
  'source',
  'summary',
  'description',
  'descriptionHtml',
  'timeLimit',
  'memoryLimit',
  'points',
  'partial',
  'isOrganizationPrivate',
  'organizations',
  'isManuallyManaged',
  'isFullMarkup',
  'isDescriptionMarkupTrusted',
  'typeIds',
  'groupId',
  'licenseId',
  'allowedLanguages',
  'languageLimits',
  'pdfStatementUrl',
  'pdfStatementBytes',
  'materialUrl',
  'materialBytes',
  'ogImage',
  'submissionSourceVisibility',
  'testcaseVisibility',
  'testcaseResultVisibility',
  'allowViewFeedback',
];

@Injectable()
export class ProblemCloneService {
  constructor(
    private readonly repository: ProblemsRepository,
    private readonly revisions: RevisionsRepository,
    private readonly problems: ProblemsService,
    private readonly policy: ProblemEditPolicyService,
    private readonly quota: QuotaService,
    private readonly dataFiles: ProblemDataFilesService,
    private readonly storage: StorageService,
  ) {}

  async clone(
    auth: AuthContext,
    code: string,
    dto: CloneProblemDto,
  ): Promise<ProblemDetailResponse> {
    const source = await this.policy.editableProblem(auth.principal, code);
    await assertCodeAvailable(this.repository, this.dataFiles, dto.code);
    const copied = Object.fromEntries(
      Object.entries(source.toJSON()).filter(([field]) =>
        CLONE_COPIED_FIELDS.includes(field),
      ),
    ) as Partial<Problem>;
    const material = await this.copyMaterial(source.materialUrl);
    const organizationId = chargedOrganization(auth.principal, {
      isOrganizationPrivate: source.isOrganizationPrivate,
      organizations: source.organizations.map(uuidStr),
    });
    const clone = await this.quota
      .charged(
        organizationId,
        { kind: 'problem', userId: auth.principal.userId, ref: dto.code },
        () =>
          withCodeTaken(() =>
            this.repository.create({
              ...copied,
              materialUrl: material?.url ?? null,
              materialBytes: material ? source.materialBytes : 0,
              code: dto.code,
              date: new Date(),
              curators: [auth.principal.userId],
            }),
          ),
      )
      .catch(async (error: unknown) => {
        if (material)
          await this.storage.delete(material.path).catch(() => undefined);
        throw error;
      });
    await this.revisions.append({
      entity: 'problem',
      entityId: clone._id,
      action: 'clone',
      userId: auth.principal.userId,
      changes: fieldDiff({}, withoutRenderedHtml(clone.toJSON())),
      comment: `Cloned problem from ${code}`,
    });
    return this.problems.detail(
      auth.principal,
      clone.code,
      BASE_STATEMENT_LANGUAGE,
    );
  }

  /** Gives the clone its own copy of the material, so a later upload to the source never changes it. A material that is not a stored file of ours (or is gone) is left out. */
  private async copyMaterial(
    url: string | null,
  ): Promise<{ url: string; path: string } | null> {
    const from = this.storage.relativePathOf(url, 'materials');
    if (!from) return null;
    const path = `materials/${newId()}/${from.split('/').pop()}`;
    try {
      return { url: await this.storage.copy(from, path), path };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
}
