import { SUBMISSION_PRIORITY } from '@libs/database';
import type { RefusingJudge } from '@libs/database';
import { COMPILE_FEATURE, GENERATE_FEATURE } from '@libs/judging';
import type { AssignmentRef, GenerateTests } from '@libs/judge-proto';
import type { AssignRequest } from '../submissions/assign-request';

export interface QueuedSubmission {
  id: string;
  /** The code judges know the problem by: a mirror's root code. */
  problemCode: string;
  languageKey: string;
  priority: number;
  /** `judgeGeneration` of the row when it was read: a judge still holding this generation or an older one holds a void run. */
  generation: number;
  /** Only this judge may take it, even while disabled: the row's `pinnedJudge` (submit with `judgeId`), kept by an accept timeout, a resync and a restart; dropped when that judge fails the run (grace expiry, RETRY) and by a rejudge. */
  judgeName: string | null;
  /** Judges that must not see it: a live or spectating contest submission's contest bans (from Mongo) plus any the command adds. */
  bannedJudges: string[];
  /** Judges that answered `Final{RETRY}` for it; cleared on every resync tick. */
  retryBannedJudges: string[];
  /** Hello features its problem's init.yml needs (`requiredJudgeFeatures`); a judge without one of them would answer with an internal error. */
  requiredFeatures: string[];
  /** Judge builds that refused it as unsupported (the row's `refusedBy`): not offered it again while the problem's data is the version they refused, so a row every judge refuses waits in the queue instead of bouncing. */
  refusedBy: RefusingJudge[];
  /** Its problem's `dataVersion` now (the root's for a mirror): a refusal made against an older version no longer holds. */
  dataVersion: number;
}

export interface JudgeState {
  readonly name: string;
  executors: ReadonlySet<string>;
  isDisabled: boolean;
  /** The judge sent `Draining`: it finishes what it holds and takes nothing new. */
  isDraining: boolean;
  slots: number;
  /** Submission id -> generation of each run it holds; 0 while the claim is still in flight. */
  readonly inFlight: Map<string, number>;
  /** `windingKey`s of runs the bridge let go of (accept timeout, rejudge void, resume DROP) that the judge has not ended yet: judge-v2 frees the slot only when the run's process returns, so the bridge counts it until that run's `Final{ABORTED}` (or the session's end). */
  readonly winding: Set<string>;
  /** Features from its Hello (`generate.polygon`, ...). */
  readonly features: ReadonlySet<string>;
  /** Build from its Hello: a refusal holds for that build only, so a new build may try again (judge-v2's build carries its commit since judge-v2 #60, so a new commit is a new build). */
  readonly build: string;
  /** Ids of the test generations it holds (a claim in flight included); each takes one slot. */
  readonly generations: Set<string>;
}

/** `"<submissionId>.<generation>"`, the key of a winding run. */
export const windingKey = (ref: AssignmentRef): string =>
  `${ref.submissionId}.${ref.generation}`;

/** Runs that occupy a slot on the judge: held ones, winding ones and generations. */
const busySlots = (judge: JudgeState): number =>
  judge.inFlight.size + judge.winding.size + judge.generations.size;

/** What the dispatcher needs from a connected judge (`JudgeSession`). */
export interface DispatchTarget extends JudgeState {
  /** Session id, sent in `Welcome`. */
  readonly id: string;
  /** True from the moment the session is ending; its close is handled a little later (`judgeLost`). */
  readonly isClosed: boolean;
  /** The key hash the judge authenticated with. */
  readonly authKeyHash: string;
  assign(request: AssignRequest): void;
  abort(ref: AssignmentRef): void;
  generate(message: GenerateTests): void;
  cancelGeneration(generationId: string): void;
  disconnect(options: { isForced: boolean; reason: string }): void;
  /** A newer session of the same judge took over. */
  replaced(): void;
}

/** Slots it can still fill; a draining judge has none. */
export const freeSlots = (judge: JudgeState): number =>
  judge.isDraining ? 0 : Math.max(0, judge.slots - busySlots(judge));

/** Busy share of its slots (winding runs included). */
export const loadOf = (judge: JudgeState): number =>
  judge.slots > 0 ? busySlots(judge) / judge.slots : 1;

/** Scheduling of test generations: a generation goes only to an enabled judge that advertises a generation feature (which queued row fits is `pickGeneration`'s call), when no queued submission waits for it and it would not take the judge's last free slot (a 1-slot judge has no other). */
export const mayStartGeneration = (
  judge: JudgeState,
  isSubmissionWaiting: boolean,
): boolean => {
  const free = freeSlots(judge);
  return (
    (judge.features.has(GENERATE_FEATURE) ||
      judge.features.has(COMPILE_FEATURE)) &&
    !judge.isDisabled &&
    !isSubmissionWaiting &&
    (free > 1 || (free === 1 && judge.slots === 1))
  );
};

/** This build refused the problem's current data; an entry without a version (stored before it was recorded) or for older data is stale. */
const hasRefused = (judge: JudgeState, submission: QueuedSubmission) =>
  submission.refusedBy.some(
    (refusing) =>
      refusing.name === judge.name &&
      refusing.build === judge.build &&
      (refusing.dataVersion ?? -1) >= submission.dataVersion,
  );

/** Runs the language, has the features the problem needs, is not banned, has not refused it as unsupported on the problem's current data, and is enabled (or asked for by name). A submission pinned to a judge without a needed feature waits until that judge upgrades or the pin is dropped (resync of an absent judge, rejudge). */
export const canJudge = (
  judge: JudgeState,
  submission: QueuedSubmission,
): boolean =>
  judge.executors.has(submission.languageKey) &&
  submission.requiredFeatures.every((feature) => judge.features.has(feature)) &&
  !submission.bannedJudges.includes(judge.name) &&
  !submission.retryBannedJudges.includes(judge.name) &&
  !hasRefused(judge, submission) &&
  (submission.judgeName === null
    ? !judge.isDisabled
    : judge.name === submission.judgeName);

const sum = (values: number[]): number =>
  values.reduce((total, value) => total + value, 0);

/** Slots no live run holds: free ones and winding ones, which open at the judge's `Final{ABORTED}`; none while draining. */
const openingSlots = (judge: JudgeState): number =>
  judge.isDraining
    ? 0
    : Math.max(0, judge.slots - judge.inFlight.size - judge.generations.size);

/** Rejudges (priority ≥ 2) leave the last slot no live run holds to new submissions whenever the candidates have more than one slot in all. A winding slot counts as opening, so a rejudge that voided its own run still takes the spare slot (conformance 21). */
const heldBack = (
  submission: QueuedSubmission,
  candidates: JudgeState[],
): boolean =>
  submission.priority >= SUBMISSION_PRIORITY.rejudge &&
  sum(
    candidates.filter((judge) => !judge.isDraining).map((judge) => judge.slots),
  ) > 1 &&
  sum(candidates.map(openingSlots)) === 1;

/** The candidate with a free slot and the lowest load, ties broken by `random`; null keeps the submission queued. */
export function pickJudge<Judge extends JudgeState>(
  judges: Iterable<Judge>,
  submission: QueuedSubmission,
  /** Must return a value in [0, 1). */
  random: () => number = Math.random,
): Judge | null {
  const candidates = [...judges].filter((judge) => canJudge(judge, submission));
  const free = candidates.filter((judge) => freeSlots(judge) > 0);
  if (!free.length || heldBack(submission, candidates)) return null;
  const lowest = Math.min(...free.map(loadOf));
  const tied = free.filter((judge) => loadOf(judge) === lowest);
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

const candidateKey = (submission: QueuedSubmission): string =>
  JSON.stringify([
    submission.languageKey,
    submission.judgeName,
    submission.bannedJudges,
    submission.retryBannedJudges,
    submission.requiredFeatures,
    submission.refusedBy,
    submission.dataVersion,
  ]);

/**
 * What a judge with a free slot takes next: the first queued submission it can judge that is not held back for new work.
 * Hold-back is decided once per candidate set, so a batch rejudge scans in O(queue + judges).
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
    const key = candidateKey(submission);
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
