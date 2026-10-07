import { SUBMISSION_PRIORITY } from '@libs/database';
import type { SubmissionRequest } from '../protocol/judge-packets';

export interface QueuedSubmission {
  id: string;
  /** The code judges know the problem by: a mirror's root code. */
  problemCode: string;
  languageKey: string;
  priority: number;
  /** Only this judge may take it, even while disabled (submit with `judgeId`). */
  judgeName: string | null;
  /** Judges that must not see it: a live or spectating contest submission's contest bans (from Mongo) plus any the command adds. */
  bannedJudges: string[];
}

export interface JudgeState {
  readonly name: string;
  problems: ReadonlySet<string>;
  executors: ReadonlySet<string>;
  isDisabled: boolean;
  /** Load per CPU from the last ping response; Infinity until the first one (legacy 1e100). */
  load: number;
  /** The submission it is judging, null when free. */
  workingOn: string | null;
}

/** What the dispatcher needs from a connected judge (`JudgeHandler`). */
export interface DispatchTarget extends JudgeState {
  /** True from the moment the socket is closing; its close is handled a little later (`judgeLost`). */
  readonly isClosed: boolean;
  /** The key hash the judge authenticated with. */
  readonly authKeyHash: string;
  submit(request: SubmissionRequest): void;
  terminate(): void;
  disconnect(force: boolean): void;
}

/** Legacy `can_judge` + banned judges; a requested judge is matched by name even when disabled. */
export const canJudge = (
  judge: JudgeState,
  submission: QueuedSubmission,
): boolean =>
  judge.problems.has(submission.problemCode) &&
  judge.executors.has(submission.languageKey) &&
  !submission.bannedJudges.includes(judge.name) &&
  (submission.judgeName === null
    ? !judge.isDisabled
    : judge.name === submission.judgeName);

const isFree = (judge: JudgeState): boolean => judge.workingOn === null;

/** Rejudges (priority ≥ 2) leave the last free candidate to new submissions whenever another judge could also take them. */
const heldBack = (
  submission: QueuedSubmission,
  candidates: JudgeState[],
): boolean =>
  submission.priority >= SUBMISSION_PRIORITY.rejudge &&
  candidates.length > 1 &&
  candidates.filter(isFree).length === 1;

/** The free candidate reporting the lowest load, ties broken by `random`; null keeps the submission queued. */
export function pickJudge<Judge extends JudgeState>(
  judges: Iterable<Judge>,
  submission: QueuedSubmission,
  /** Must return a value in [0, 1). */
  random: () => number = Math.random,
): Judge | null {
  const candidates = [...judges].filter((judge) => canJudge(judge, submission));
  const free = candidates.filter(isFree);
  if (!free.length || heldBack(submission, candidates)) return null;
  const lowest = Math.min(...free.map((judge) => judge.load));
  const tied = free.filter((judge) => judge.load === lowest);
  return tied[Math.floor(random() * tied.length)];
}

const comesBefore = (
  left: QueuedSubmission,
  right: QueuedSubmission,
): boolean =>
  left.priority < right.priority ||
  (left.priority === right.priority && left.id < right.id);

/** Keeps `queue` in priority, then id order (UUIDv7 ids grow with time, so FIFO); binary search keeps a 100k-entry batch rejudge cheap. */
export function insertQueued(
  queue: QueuedSubmission[],
  submission: QueuedSubmission,
): void {
  let low = 0;
  let high = queue.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (comesBefore(submission, queue[middle])) high = middle;
    else low = middle + 1;
  }
  queue.splice(low, 0, submission);
}

/**
 * What a judge that just became free (or connected) takes: the first queued submission it can judge that is not held back for new work.
 * `judge` must be among `judges` and already marked free. Hold-back is decided once per candidate set, so a batch rejudge scans in O(queue + judges).
 */
export function nextFor(
  judge: JudgeState,
  queue: readonly QueuedSubmission[],
  judges: Iterable<JudgeState>,
): QueuedSubmission | null {
  const all = [...judges];
  const heldByCandidates = new Map<string, boolean>();
  const isHeld = (submission: QueuedSubmission): boolean => {
    if (submission.priority < SUBMISSION_PRIORITY.rejudge) return false;
    const key = JSON.stringify([
      submission.problemCode,
      submission.languageKey,
      submission.judgeName,
      submission.bannedJudges,
    ]);
    let held = heldByCandidates.get(key);
    if (held === undefined) {
      held = heldBack(
        submission,
        all.filter((other) => canJudge(other, submission)),
      );
      heldByCandidates.set(key, held);
    }
    return held;
  };
  return (
    queue.find(
      (submission) => canJudge(judge, submission) && !isHeld(submission),
    ) ?? null
  );
}
