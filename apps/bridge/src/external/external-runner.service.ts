import { Inject, Injectable, Logger } from '@nestjs/common';
import { clipBytes } from '@libs/common';
import { MAX_CASE_FEEDBACK_LENGTH } from '@libs/database';
import type { ExternalRun, SubmissionCase } from '@libs/database';
import {
  EXTERNAL_JUDGE_NAME,
  ExternalJudgeClient,
  ExternalJudgeError,
  isSubmitFailed,
  mapExternalResult,
  SUBMIT_FAILED_MESSAGE,
} from '@libs/judging';
import type { ExternalCase, ExternalOutcome, RemoteRun } from '@libs/judging';
import { SettingsService } from '@libs/settings';
import { BRIDGE_TIMINGS } from '../bridge-timings';
import type { BridgeTimings } from '../bridge-timings';
import type { QueuedSubmission } from '../dispatch/slots';
import type { Claimed } from '../submissions/runs.service';
import { RunsService } from '../submissions/runs.service';
import { SubmissionsRepository } from '../submissions/submissions.repository';
import type { RunKey } from '../submissions/write-outcome';
import { ExternalRunsRepository } from './external-runs.repository';
import type { HeldRow, SubmitTarget } from './external-runs.repository';

/** Failed polls back off ×1.5 each, up to this. */
export const EXTERNAL_MAX_BACKOFF_MS = 30_000;
export const UNMAPPED_LANGUAGE_MESSAGE = (languageKey: string) =>
  `Language ${languageKey} is not supported for this problem`;
export const FILE_SUBMISSION_MESSAGE =
  'The external judge does not take file submissions';
export const TIMED_OUT_MESSAGE = (minutes: number) =>
  `No result from the external judge within ${minutes} minutes`;

type FinalOutcome = Exclude<ExternalOutcome, { kind: 'processing' }>;

const keyOf = (row: HeldRow, seq: number): RunKey => ({
  ref: { submissionId: row.id, generation: row.generation },
  judgeName: EXTERNAL_JUDGE_NAME,
  seq,
});

const caseRowOf = (testCase: ExternalCase): SubmissionCase => ({
  position: 1,
  status: testCase.status,
  time: testCase.time,
  memory: testCase.memory,
  points: testCase.points,
  total: testCase.total,
  batch: null,
  feedback: clipBytes(testCase.feedback, MAX_CASE_FEEDBACK_LENGTH),
  extendedFeedback: '',
  output: '',
});

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * The external judge as a pseudo-judge (`@external`): claims queued submissions of external problems, submits them to the PCD VJudge,
 * polls the remote run and writes the result through the same seq-checked writes a judge's messages cause (seq 1 accepted, 2 grading,
 * 3 the one case, then Final). Mongo is the truth: every tick re-reads the rows it holds, so a restart resumes polling.
 */
@Injectable()
export class ExternalRunnerService {
  private readonly logger = new Logger(ExternalRunnerService.name);
  private timer?: NodeJS.Timeout;
  private ticking: Promise<void> | null = null;
  private tickAgain = false;
  private stopped = true;
  private lastSubmitAt = 0;

  constructor(
    @Inject(BRIDGE_TIMINGS) private readonly timings: BridgeTimings,
    private readonly client: ExternalJudgeClient,
    private readonly settings: SettingsService,
    private readonly repository: ExternalRunsRepository,
    private readonly submissions: SubmissionsRepository,
    private readonly runs: RunsService,
  ) {}

  start(): void {
    this.stopped = false;
    this.timer = setInterval(() => this.wake(), this.timings.externalTickMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    await this.ticking;
  }

  /** A tick now, or right after the running one (a command named new work). */
  wake(): void {
    if (this.stopped) return;
    if (this.ticking) {
      this.tickAgain = true;
      return;
    }
    this.ticking = this.tickWhileWoken().finally(() => {
      this.ticking = null;
    });
  }

  /** The api aborted a submission: a run the adapter holds ends as AB; the remote run is left to finish and its answer ignored. */
  async abort(submissionId: string): Promise<void> {
    const row = await this.repository.heldRow(submissionId);
    if (row)
      await this.runs.graceExpired(
        keyOf(row, 0).ref,
        EXTERNAL_JUDGE_NAME,
        true,
      );
  }

  private async tickWhileWoken(): Promise<void> {
    do {
      this.tickAgain = false;
      await this.tick().catch((error: Error) =>
        this.logger.error(`External judge tick failed: ${error.message}`),
      );
    } while (this.tickAgain && !this.stopped);
  }

  /** Held runs first (they free capacity), then new claims up to `externalJudge.maxInFlight`. Unconfigured: nothing moves; queued rows wait. */
  private async tick(): Promise<void> {
    if (!this.client.isConfigured()) return;
    const held = await this.repository.heldRows();
    for (const row of held) {
      if (this.stopped) return;
      await this.advance(row);
    }
    const capacity =
      this.settings.get('externalJudge.maxInFlight') - held.length;
    const ids = await this.repository.queuedIds(capacity);
    const queued = ids.length
      ? await this.submissions.loadQueued(ids, { external: true })
      : [];
    for (const submission of queued) {
      if (this.stopped) return;
      await this.waitForSubmitGap();
      await this.claimAndSubmit(submission);
    }
  }

  /** One held run: lost (no remote id for this generation), timed out, not due yet, still judging, or finished. */
  private async advance(row: HeldRow): Promise<void> {
    const run = await this.repository.runOf(row.id);
    if (!run || run.generation !== row.generation || !run.remoteId)
      return this.lost(row);
    if (this.isTimedOut(run))
      return this.finish(row, {
        kind: 'internal-error',
        message: TIMED_OUT_MESSAGE(
          this.settings.get('externalJudge.maxWaitMinutes'),
        ),
      });
    if (!this.isDue(run)) return;
    const answer = await this.poll(row, run.remoteId);
    if (!answer) return;
    await this.repository.answered(row.id, row.generation, answer);
    const outcome = mapExternalResult(answer, {
      partial: await this.repository.isPartial(row.id),
    });
    if (outcome.kind !== 'processing') await this.finish(row, outcome);
  }

  /** The bridge stopped between claim and submit: the remote may or may not have the run. Requeued once (the judge-loss rule), internal error the second time, so it is submitted at most twice and never lost. */
  private async lost(row: HeldRow): Promise<void> {
    const outcome = await this.runs.graceExpired(
      keyOf(row, 0).ref,
      EXTERNAL_JUDGE_NAME,
      false,
    );
    this.logger.warn(
      `External run of submission ${row.id} gen ${row.generation} has no remote id: ${outcome}`,
    );
  }

  private isTimedOut(run: ExternalRun): boolean {
    const maxWaitMs =
      this.settings.get('externalJudge.maxWaitMinutes') * 60_000;
    return (
      !!run.submittedAt && Date.now() - run.submittedAt.getTime() > maxWaitMs
    );
  }

  private isDue(run: ExternalRun): boolean {
    const since = run.lastPolledAt ?? run.submittedAt;
    if (!since) return true;
    const interval = Math.min(
      this.timings.externalPollMs * 1.5 ** Math.min(run.pollErrors, 5),
      EXTERNAL_MAX_BACKOFF_MS,
    );
    return Date.now() - since.getTime() >= interval;
  }

  /** The remote answer, or null: a transient failure backs off, any other ends the run as an internal error. */
  private async poll(
    row: HeldRow,
    remoteId: string,
  ): Promise<RemoteRun | null> {
    try {
      return await this.client.status(remoteId);
    } catch (error) {
      if (error instanceof ExternalJudgeError && !error.isTransient) {
        await this.finish(row, {
          kind: 'internal-error',
          message: error.message,
        });
        return null;
      }
      this.logger.warn(
        `Polling the external run of submission ${row.id} failed: ${(error as Error).message}`,
      );
      await this.repository.pollFailed(row.id, row.generation);
      return null;
    }
  }

  private async waitForSubmitGap(): Promise<void> {
    const wait =
      this.lastSubmitAt + this.timings.externalSubmitGapMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastSubmitAt = Date.now();
  }

  /** Claim (QU → P, new generation), then submit; the run is accepted and grading once the remote id is stored. */
  private async claimAndSubmit(submission: QueuedSubmission): Promise<void> {
    const claimed = await this.runs.claim(submission, EXTERNAL_JUDGE_NAME);
    if (!claimed) return;
    this.runs.sent(claimed);
    const row: HeldRow = {
      id: submission.id,
      generation: claimed.request.ref.generation,
      judgeSeq: 0,
    };
    const target = await this.repository.submitTarget(row.id);
    // the link was switched off meanwhile: back to the queue, where a judge takes it
    if (!target)
      return void (await this.runs.release(
        keyOf(row, 0).ref,
        EXTERNAL_JUDGE_NAME,
      ));
    const refusal = this.refusalOf(claimed, target, submission.languageKey);
    if (refusal)
      return this.finish(row, { kind: 'compile-error', log: refusal });
    await this.submit(
      row,
      { ...target, remoteLanguage: target.remoteLanguage! },
      claimed.request.source,
    );
  }

  private refusalOf(
    claimed: Claimed,
    target: SubmitTarget,
    languageKey: string,
  ): string | null {
    if (claimed.request.fileOnly) return FILE_SUBMISSION_MESSAGE;
    return target.remoteLanguage
      ? null
      : UNMAPPED_LANGUAGE_MESSAGE(languageKey);
  }

  private async submit(
    row: HeldRow,
    target: SubmitTarget & { remoteLanguage: string },
    source: string,
  ): Promise<void> {
    await this.repository.start(row.id, row.generation, target);
    let answer: RemoteRun;
    try {
      answer = await this.client.submit({
        oj: target.oj,
        problemId: target.problemId,
        language: target.remoteLanguage,
        source,
      });
    } catch (error) {
      const message =
        error instanceof ExternalJudgeError
          ? error.message
          : SUBMIT_FAILED_MESSAGE;
      return this.finish(row, { kind: 'internal-error', message });
    }
    if (isSubmitFailed(answer) || !answer.remoteId)
      return this.finish(row, {
        kind: 'internal-error',
        message: answer.errorMessage ?? SUBMIT_FAILED_MESSAGE,
      });
    await this.repository.submitted(row.id, row.generation, answer);
    if ((await this.runs.accepted(keyOf(row, 1))) === 'applied')
      await this.runs.started(keyOf(row, 2), false);
  }

  /** The run's last writes from wherever it stands (a restart may leave it at any seq); a write that is not applied (rejudged, aborted) ends it. */
  private async finish(row: HeldRow, outcome: FinalOutcome): Promise<void> {
    if (outcome.kind === 'compile-error')
      return void (await this.runs.final(keyOf(row, row.judgeSeq + 1), {
        kind: 'compile-error',
        log: outcome.log,
        dataVersionUsed: 0,
      }));
    if (outcome.kind === 'internal-error')
      return void (await this.runs.final(keyOf(row, row.judgeSeq + 1), {
        kind: 'internal-error',
        log: outcome.message,
        dataVersionUsed: 0,
      }));
    const seq = await this.writeCase(row, outcome.testCase);
    if (seq !== null)
      await this.runs.final(keyOf(row, seq + 1), {
        kind: 'graded',
        log: '',
        dataVersionUsed: 0,
      });
  }

  /** Accepted, grading and the case, each only if not written yet; the seq reached, or null when a write was refused. */
  private async writeCase(
    row: HeldRow,
    testCase: ExternalCase,
  ): Promise<number | null> {
    const steps: [number, (key: RunKey) => Promise<string>][] = [
      [1, (key) => this.runs.accepted(key)],
      [2, (key) => this.runs.started(key, false)],
      [3, (key) => this.runs.cases(key, [caseRowOf(testCase)])],
    ];
    for (const [seq, write] of steps) {
      if (row.judgeSeq >= seq) continue;
      if ((await write(keyOf(row, seq))) !== 'applied') return null;
    }
    return Math.max(row.judgeSeq, 3);
  }
}
