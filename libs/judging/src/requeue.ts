import type { UpdateQuery } from 'mongoose';
import type { Submission } from '@libs/database';

/** Pending rows final judging will requeue; an editor-rejected row stays rejected. The api's "pending rows exist" check uses the same filter, so it never blocks on a row nothing will judge. */
export const JUDGEABLE_PENDING = {
  status: 'PD',
  result: { $ne: 'RJ' },
} as const;

/** Legacy `judge_submission`: back to QU at `priority` with every result cleared. The requeue and retry allowances are restored and `judgeGeneration` is kept (the next claim bumps it): a rejudge is a fresh attempt. Shared by the api's rejudges and the worker's final judging, so every requeue path resets the same fields. */
export const requeueUpdate = (priority: number): UpdateQuery<Submission> => ({
  $set: {
    status: 'QU',
    result: null,
    time: null,
    memory: null,
    points: null,
    casePoints: 0,
    caseTotal: 0,
    error: null,
    cases: [],
    currentTestcase: 0,
    batch: false,
    isPretested: false,
    judgedOn: null,
    judgedDate: null,
    rejudgedDate: new Date(),
    priority,
    requeueCount: 0,
    retryCount: 0,
  },
});
