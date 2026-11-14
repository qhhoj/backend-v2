import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { AppError, invalidField, issueError } from '@libs/common';
import { isLanguageActive, uuidStr } from '@libs/database';
import type { Language, ShareCopy, ShareLanguage } from '@libs/database';
import { LanguagesQuerier } from '../../problems/catalog/languages.querier';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import type { ProblemDocument } from '../../problems/core/problems.repository';
import { SubmissionsRepository } from '../../submissions/core/submissions.repository';
import type { SubmissionDocument } from '../../submissions/core/submissions.repository';
import { SubmissionsService } from '../../submissions/core/submissions.service';
import { ShareSummaryResponse } from '../core/dto/share.response';
import { expiresAtOf } from '../core/share-expiry';
import { copyRefusalError } from '../core/share-hidden-reason';
import { cleanTitle } from '../core/share-title';
import { ShareWriterService } from '../core/share-writer.service';
import { ShareGuardService } from '../guard/share-guard.service';
import type {
  CreatePasteDto,
  CreateSubmissionShareDto,
} from './dto/create-share.dto';
import { copyCaseUnit, frozenCopyOf, isShareable } from './frozen-copy';
import { pasteSourceError } from './paste-source';

/** 409 `conflict` with issue `submission_not_shareable`: what `actions.canShare` tells the SPA ahead of time. */
const notShareable = (message: string) =>
  issueError('conflict', 409, {
    field: 'submissionId',
    code: 'submission_not_shareable',
    message,
  });

/** Copied, so a later rename or retirement of the language changes nothing. */
const shareLanguageOf = (language: Language): ShareLanguage => ({
  id: language._id,
  key: language.key,
  name: language.name,
  extension: language.extension,
});

@Injectable()
export class ShareCreateService {
  constructor(
    private readonly submissions: SubmissionsService,
    private readonly submissionRows: SubmissionsRepository,
    private readonly problems: ProblemsRepository,
    private readonly languages: LanguagesQuerier,
    private readonly guard: ShareGuardService,
    private readonly writer: ShareWriterService,
  ) {}

  /** A frozen copy of the caller's own finished submission, unless a contest or the setter's source rule keeps it closed. */
  async createCopy(
    principal: Principal,
    dto: CreateSubmissionShareDto,
  ): Promise<ShareSummaryResponse> {
    const now = new Date();
    const { submission, problem } = await this.ownSubmission(
      principal,
      dto.submissionId,
    );
    const language = this.copiedLanguage(submission);
    const refusal = await this.guard.refusalOf(
      {
        problemId: uuidStr(submission.problem),
        problem: problem.deletedAt ? null : problem,
        contestId: submission.contest ? uuidStr(submission.contest) : null,
      },
      now,
    );
    if (refusal) throw copyRefusalError(refusal);
    const [copy, source] = await Promise.all([
      this.copyOf(submission, problem),
      this.submissionRows.findSource(uuidStr(submission._id)),
    ]);
    const share = await this.writer.insert(
      principal,
      {
        kind: 'submission',
        title: cleanTitle(dto.title),
        language,
        source: source ?? '',
        expiresAt: expiresAtOf(dto.expiry ?? 'never', now),
        copy,
      },
      now,
    );
    return ShareSummaryResponse.from(share);
  }

  /** Pasted code in a known, text language. */
  async createPaste(
    principal: Principal,
    dto: CreatePasteDto,
  ): Promise<ShareSummaryResponse> {
    const now = new Date();
    const sourceError = pasteSourceError(dto.source);
    if (sourceError) throw sourceError;
    const share = await this.writer.insert(
      principal,
      {
        kind: 'paste',
        title: cleanTitle(dto.title),
        language: this.pasteLanguage(dto.languageId),
        source: dto.source,
        expiresAt: expiresAtOf(dto.expiry ?? '30d', now),
        copy: null,
      },
      now,
    );
    return ShareSummaryResponse.from(share);
  }

  /** The submission page's visibility rule (404), then ownership: staff may read others' code but never publish it. */
  private async ownSubmission(
    principal: Principal,
    submissionId: string,
  ): Promise<{ submission: SubmissionDocument; problem: ProblemDocument }> {
    const visible = await this.submissions.visible(
      principal,
      submissionId,
      await this.submissions.viewerScope(principal),
    );
    if (uuidStr(visible.submission.user) !== principal.userId)
      throw new AppError(
        'forbidden',
        403,
        'Only the owner can share a submission',
      );
    if (!isShareable(visible.submission))
      throw notShareable(
        'Only a judged or compile-error submission can be shared',
      );
    return visible;
  }

  /** A file-only language's source is an uploaded file, not text. */
  private copiedLanguage(submission: SubmissionDocument): ShareLanguage {
    const language = this.languages.byId(uuidStr(submission.language));
    if (!language || language.fileOnly)
      throw notShareable('This submission has no source text to share');
    return shareLanguageOf(language);
  }

  private pasteLanguage(languageId: string): ShareLanguage {
    const language = this.languages.byId(languageId);
    if (!language || !isLanguageActive(language))
      throw invalidField('languageId', 'Unknown language.', 'language_unknown');
    if (language.fileOnly)
      throw invalidField(
        'languageId',
        'This language takes a file, not text.',
        'language_takes_file',
      );
    return shareLanguageOf(language);
  }

  /** Cases (up to 10000 rows) are read only when the visitor's rule shows them. */
  private async copyOf(
    submission: SubmissionDocument,
    problem: ProblemDocument,
  ): Promise<ShareCopy> {
    if (copyCaseUnit(problem) === 'none')
      return frozenCopyOf({ submission, problem, caseCount: null });
    const [withCases, caseCount] = await Promise.all([
      this.submissionRows.findById(uuidStr(submission._id), {
        withCases: true,
      }),
      this.problems.caseCount(uuidStr(problem._id)),
    ]);
    return frozenCopyOf({
      submission: withCases ?? submission,
      problem,
      caseCount,
    });
  }
}
