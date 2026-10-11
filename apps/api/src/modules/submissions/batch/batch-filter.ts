import { hasPermission } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { IN_FLIGHT_STATUSES, UNFINISHED_STATUSES } from '@libs/database';
import type { Submission } from '@libs/database';
import type { FilterQuery } from 'mongoose';
import type { SubmissionBatchFilterDto } from './dto/submission-batch.dto';

/** Where a batch reaches: one contest's submissions, one problem's, or the whole site. `canEdit` is the edit right on that contest or problem. */
export type BatchScope =
  | { kind: 'contest'; canEdit: boolean }
  | { kind: 'problem'; canEdit: boolean }
  | { kind: 'site' };

/** Ids the named contest, problem and user resolved to. Without a problem, `deletedProblemIds` are left out: a deleted problem's submissions are history (a rejudge would overwrite them while the data is gone). */
export interface BatchRefs {
  contestId?: string;
  problemId?: string;
  userId?: string;
  deletedProblemIds?: string[];
}

/** Legacy admin `judge` action: `judge.rejudge_submission` plus edit rights on the scope; a site-wide batch touches problems the caller may not own, so it needs `judge.edit_all_problem`. */
export function mayRunBatch(principal: Principal, scope: BatchScope): boolean {
  if (!hasPermission(principal, 'judge.rejudge_submission')) return false;
  return scope.kind === 'site'
    ? hasPermission(principal, 'judge.edit_all_problem')
    : scope.canEdit;
}

const refClauses = (refs: BatchRefs): FilterQuery<Submission> => ({
  ...(refs.contestId ? { contest: refs.contestId } : {}),
  ...(refs.problemId
    ? { problem: refs.problemId }
    : refs.deletedProblemIds?.length
      ? { problem: { $nin: refs.deletedProblemIds } }
      : {}),
  ...(refs.userId ? { user: refs.userId } : {}),
});

const idClause = (dto: SubmissionBatchFilterDto): FilterQuery<Submission> => {
  const range = {
    ...(dto.ids ? { $in: dto.ids } : {}),
    ...(dto.idFrom ? { $gte: dto.idFrom } : {}),
    ...(dto.idTo ? { $lte: dto.idTo } : {}),
  };
  return Object.keys(range).length ? { _id: range } : {};
};

const dateClause = (dto: SubmissionBatchFilterDto): FilterQuery<Submission> => {
  const range = {
    ...(dto.dateFrom ? { $gte: new Date(dto.dateFrom) } : {}),
    ...(dto.dateTo ? { $lt: new Date(dto.dateTo) } : {}),
  };
  return Object.keys(range).length ? { date: range } : {};
};

const valueClauses = (
  dto: SubmissionBatchFilterDto,
): FilterQuery<Submission> => ({
  ...(dto.languages?.length ? { language: { $in: dto.languages } } : {}),
  ...(dto.results?.length ? { result: { $in: dto.results } } : {}),
  ...(dto.judgedOn ? { judgedOn: dto.judgedOn } : {}),
});

/** Every stored-field condition of the filter, before the action's own status rule. */
const matchClauses = (
  refs: BatchRefs,
  dto: SubmissionBatchFilterDto,
): FilterQuery<Submission> => ({
  ...refClauses(refs),
  ...idClause(dto),
  ...dateClause(dto),
  ...valueClauses(dto),
});

/** What a bulk rejudge resets: never rows a judge holds or pending final-submission rows (contest judging owns them), and locked rows (`isSubmissionLocked`) only with `force`. */
export function rejudgeFilter(
  refs: BatchRefs,
  dto: SubmissionBatchFilterDto & { force?: boolean },
  now = new Date(),
): FilterQuery<Submission> {
  return {
    ...matchClauses(refs, dto),
    status: { $nin: [...IN_FLIGHT_STATUSES, 'PD'] },
    ...(dto.force
      ? {}
      : { $or: [{ lockedAfter: null }, { lockedAfter: { $gte: now } }] }),
  };
}

/** What a rescore recomputes: finished rows (a queued or running one gets its points when it finishes). */
export function rescoreFilter(
  refs: BatchRefs,
  dto: SubmissionBatchFilterDto,
): FilterQuery<Submission> {
  return {
    ...matchClauses(refs, dto),
    status: { $nin: [...UNFINISHED_STATUSES, 'PD'] },
  };
}
