import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS, runCoalesced } from '@libs/common';
import { contestPhase, finalSubmissionFormat } from '@libs/contests';
import { SUBMISSION_PRIORITY } from '@libs/database';
import {
  BridgeCommandsService,
  JUDGE_COMMAND_BATCH,
  submissionEvent,
  SubmissionEventsService,
} from '@libs/judging';
import type { SubmissionGradedJob } from '@libs/judging';
import { ContestFinalJudgeRepository } from './contest-final-judge.repository';

@Injectable()
export class ContestFinalJudgeService {
  constructor(
    private readonly repository: ContestFinalJudgeRepository,
    private readonly commands: BridgeCommandsService,
    private readonly events: SubmissionEventsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Legacy `judge_final_submissions` for an ended FSO contest (a started one on an editor's request), for pending rows only: each participation's newest pending row per problem (the one the format scores) goes back to the queue at batch priority first, then every older pending row at backlog priority, behind all other work; each is announced as `queued` and commanded to the bridge a batch at a time. Serialised per contest across processes; a row leaves PD once, so racing triggers requeue each submission exactly once. Automatic runs skip `autoJudge: false`. Returns how many this call requeued. */
  async judgeFinal(
    contestId: string,
    { isManual, now = new Date() }: { isManual: boolean; now?: Date },
  ): Promise<number> {
    const contest = await this.repository.findContest(contestId);
    if (!contest || contest.formatName !== 'final_submission') return 0;
    const phase = contestPhase(contest, now);
    if (isManual ? phase === 'upcoming' : phase !== 'ended') return 0;
    if (
      !isManual &&
      !finalSubmissionFormat.parseConfig(contest.formatConfig).autoJudge
    )
      return 0;
    let requeued = 0;
    await runCoalesced(
      this.redis,
      `contest-final-judge:${contestId}`,
      async () => {
        for await (const rows of this.repository.newestPendingRows(
          contestId,
          JUDGE_COMMAND_BATCH,
        ))
          requeued += await this.requeue(
            rows,
            SUBMISSION_PRIORITY.batchRejudge,
          );
        for (
          let rows = await this.repository.pendingRows(
            contestId,
            JUDGE_COMMAND_BATCH,
          );
          rows.length;
          rows = await this.repository.pendingRows(
            contestId,
            JUDGE_COMMAND_BATCH,
          )
        )
          requeued += await this.requeue(rows, SUBMISSION_PRIORITY.backlog);
      },
    );
    return requeued;
  }

  /** One batch back to the queue at `priority`, commanded and announced. */
  private async requeue(
    rows: SubmissionGradedJob[],
    priority: number,
  ): Promise<number> {
    const ids = rows.map((row) => row.submissionId);
    await this.repository.requeue(ids, priority);
    await this.commands.judge(ids);
    await Promise.all(
      rows.map((row) =>
        this.events.publish(submissionEvent(row, 'queued', 'QU')),
      ),
    );
    return ids.length;
  }

  /** Every minute: ended FSO contests still holding pending rows (a lost delayed job, a submission stored at the last moment). */
  async sweep(now = new Date()): Promise<number> {
    let requeued = 0;
    for (const contestId of await this.repository.pendingContestIds())
      requeued += await this.judgeFinal(contestId, { isManual: false, now });
    return requeued;
  }
}
