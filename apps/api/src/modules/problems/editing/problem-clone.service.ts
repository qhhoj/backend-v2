import { Injectable } from '@nestjs/common';
import type { AuthContext } from '@libs/auth';
import type { Problem } from '@libs/database';
import { fieldDiff } from '@libs/problems';
import { CloneProblemDto } from './dto/clone.dto';
import { ProblemDetailResponse } from '../core/dto/problem-detail.response';
import { ProblemEditPolicyService } from './problem-edit-policy.service';
import { withCodeTaken, withoutRenderedHtml } from './problem-edit-fields';
import { ProblemsRepository } from '../core/problems.repository';
import { ProblemsService } from '../core/problems.service';
import { RevisionsRepository } from '../core/revisions.repository';

/** Never carried over by a clone: identity, timestamps, people, statement translations, editorial, mirror links and test data. */
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
];
/** Copied by value; together with CLONE_RESET_FIELDS this must cover every schema path. */
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
  'typeIds',
  'groupId',
  'licenseId',
  'allowedLanguages',
  'languageLimits',
  'pdfStatementUrl',
  'materialUrl',
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
  ) {}

  async clone(
    auth: AuthContext,
    code: string,
    dto: CloneProblemDto,
  ): Promise<ProblemDetailResponse> {
    const source = await this.policy.editableProblem(auth.principal, code);
    const copied = Object.fromEntries(
      Object.entries(source.toJSON()).filter(([field]) =>
        CLONE_COPIED_FIELDS.includes(field),
      ),
    ) as Partial<Problem>;
    const clone = await withCodeTaken(() =>
      this.repository.create({
        ...copied,
        code: dto.code,
        date: new Date(),
        curators: [auth.principal.userId],
      }),
    );
    await this.revisions.append({
      entity: 'problem',
      entityId: clone._id,
      action: 'clone',
      userId: auth.principal.userId,
      changes: fieldDiff({}, withoutRenderedHtml(clone.toJSON())),
      comment: `Cloned problem from ${code}`,
    });
    return this.problems.detail(auth.principal, clone.code, 'en');
  }
}
