import { ApiProperty } from '@nestjs/swagger';
import {
  SHAREABLE_STATUSES,
  SUBMISSION_RESULTS,
  SHARE_KINDS,
  uuidStr,
} from '@libs/database';
import type {
  CaseStatus,
  ShareableStatus,
  ShareCase,
  ShareCopy,
  ShareKind,
  SubmissionResult,
} from '@libs/database';
import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';
import { SubmissionBatchResponse } from '../../../submissions/core/dto/submission-detail.response';
import {
  ShareLanguageResponse,
  ShareTakedownResponse,
} from '../../core/dto/share.response';
import { SHARE_HIDDEN_REASONS } from '../../core/share-hidden-reason';
import type { ShareHiddenReason } from '../../core/share-hidden-reason';
import type { ReadableShare } from '../../core/share-access.service';

export class ShareCaseResponse {
  /** Position of the case in judging order. */
  position!: number;
  /** Case verdict: `AC`, `WA`, `TLE`, `MLE`, `OLE`, `IR`, `RTE` or `SC`. */
  status!: CaseStatus;
  /** Running time in seconds. */
  time!: number;
  /** Memory used in KiB. */
  memory!: number;
  /** Points earned by the case. */
  points!: number;
  /** Points available for the case. */
  total!: number;
  /** Batch number, from 1; null for a case outside any batch. */
  batch!: number | null;
}

const caseResponse = (testCase: ShareCase): ShareCaseResponse => ({
  position: testCase.position,
  status: testCase.status,
  time: testCase.time,
  memory: testCase.memory,
  points: testCase.points,
  total: testCase.total,
  batch: testCase.batch,
});

/** The submission's result as a visitor could see it when it was shared; never changes afterwards. */
export class FrozenCopyResponse {
  /** `D` judged or `CE` compile error. */
  @ApiProperty({ enum: SHAREABLE_STATUSES, enumName: 'ShareableStatus' })
  status!: ShareableStatus;
  /** Verdict at share time. */
  @ApiProperty({
    enum: SUBMISSION_RESULTS,
    enumName: 'SubmissionResult',
    nullable: true,
  })
  result!: SubmissionResult | null;
  /** Points awarded. */
  points!: number | null;
  /** The problem's points at share time. */
  problemPoints!: number;
  /** Points earned over all test cases. */
  casePoints!: number;
  /** Points available over all test cases. */
  caseTotal!: number;
  /** Largest running time in seconds. */
  time!: number | null;
  /** Largest memory use in KiB. */
  memory!: number | null;
  /** When the submission was made. */
  submittedAt!: Date;
  /** When it was judged. */
  judgedAt!: Date | null;
  /** Every case, when the problem showed them to visitors. */
  cases!: ShareCaseResponse[] | null;
  /** Batch summaries, when the problem showed only those. */
  batches!: SubmissionBatchResponse[] | null;
  /** The problem's case count; null when only totals are shown. */
  caseCount!: number | null;
  /** The compiler's output of a `CE`. */
  compileLog!: string | null;

  static from(copy: ShareCopy): FrozenCopyResponse {
    return {
      status: copy.status,
      result: copy.result,
      points: copy.points,
      problemPoints: copy.problemPoints,
      casePoints: copy.casePoints,
      caseTotal: copy.caseTotal,
      time: copy.time,
      memory: copy.memory,
      submittedAt: copy.submittedAt,
      judgedAt: copy.judgedAt,
      cases: copy.cases?.map(caseResponse) ?? null,
      batches:
        copy.batches?.map(({ batch, status, points, total }) => ({
          batch,
          status,
          points,
          total,
        })) ?? null,
      caseCount: copy.caseCount,
      compileLog: copy.compileLog,
    };
  }
}

export class ShareProblemResponse {
  /** Problem code, for the link `/problems/<code>`. */
  code!: string;
  /** Problem name. */
  name!: string;
}

/** What the viewer may do with the share. */
export class ShareViewerResponse {
  /** The viewer made it. */
  isOwner!: boolean;
  /** The owner may change the title and expiry. */
  canEdit!: boolean;
  /** The owner, or staff with `judge.manage_share`. */
  canDelete!: boolean;
  /** Staff with `judge.manage_share`: take down or restore. */
  canTakeDown!: boolean;
  /** Signed in and not the owner. */
  canReport!: boolean;
}

/** The public share page `/c/<code>`. */
export class ShareViewResponse {
  /** The code in `/c/<code>`. */
  code!: string;
  /** `submission`: a frozen copy; `paste`: pasted code. */
  @ApiProperty({ enum: SHARE_KINDS, enumName: 'ShareKind' })
  kind!: ShareKind;
  /** The owner's title; may be empty. */
  title!: string;
  /** The language at share time. */
  language!: ShareLanguageResponse;
  /** Who shared it; null only for staff reading a share whose author is gone. */
  author!: UserSummaryResponse | null;
  /** When it was shared. */
  createdAt!: Date;
  /** When the link stops working; null if never. */
  expiresAt!: Date | null;
  /** The code. */
  source!: string;
  /** What the raw and download links name the file. */
  filename!: string;
  /** The submission's result; null for a paste. */
  copy!: FrozenCopyResponse | null;
  /** The copied submission; shown to the owner and staff only. */
  submissionId!: string | null;
  /** The copied submission's problem, only for viewers who may see the problem. */
  problem!: ShareProblemResponse | null;
  /** Why everyone else is refused it now; only the owner and staff read a share that has one. */
  @ApiProperty({
    enum: SHARE_HIDDEN_REASONS,
    enumName: 'ShareHiddenReason',
    nullable: true,
  })
  hiddenReason!: ShareHiddenReason | null;
  /** The takedown; staff only. */
  takenDown!: ShareTakedownResponse | null;
  viewer!: ShareViewerResponse;

  static from(
    readable: ReadableShare,
    {
      filename,
      problem,
      viewer,
    }: {
      filename: string;
      problem: ShareProblemResponse | null;
      viewer: ShareViewerResponse;
    },
  ): ShareViewResponse {
    const { share, author, isOwner, canManage, hiddenReason } = readable;
    const isPrivileged = isOwner || canManage;
    return {
      code: share.code,
      kind: share.kind,
      title: share.title,
      language: ShareLanguageResponse.from(share.language),
      author: author ? UserSummaryResponse.from(author) : null,
      createdAt: share.createdAt,
      expiresAt: share.expiresAt,
      source: share.source,
      filename,
      copy: share.copy ? FrozenCopyResponse.from(share.copy) : null,
      submissionId:
        isPrivileged && share.copy ? uuidStr(share.copy.submissionId) : null,
      problem,
      hiddenReason,
      takenDown: canManage ? ShareTakedownResponse.from(share.takenDown) : null,
      viewer,
    };
  }
}
