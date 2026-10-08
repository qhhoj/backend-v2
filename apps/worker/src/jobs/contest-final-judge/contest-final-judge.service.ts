import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS, runCoalesced } from '@libs/common';
import { contestPhase, finalSubmissionFormat } from '@libs/contests';
import {
  BridgeCommandsService,
  JUDGE_COMMAND_BATCH,
  submissionEvent,
  SubmissionEventsService,
} from '@libs/judging';
import { ContestFinalJudgeRepository } from './contest-final-judge.repository';

@Injectable()
export class ContestFinalJudgeService {
  constructor(
    private readonly repository: ContestFinalJudgeRepository,
    private readonly commands: BridgeCommandsService,
    private readonly events: SubmissionEventsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Legacy `judge_final_submissions` for an ended FSO contest, for pending rows only: back to the queue, announced as `queued` and commanded to the bridge a batch at a time. Serialised per contest across processes; a row leaves PD once, so racing triggers requeue each submission exactly once. Automatic runs skip `autoJudge: false`. Returns how many this call requeued. */
  async judgeFinal(
    contestId: string,
    { isManual, now = new Date() }: { isManual: boolean; now?: Date },
  ): Promise<number> {
    const contest = await this.repository.findContest(contestId);
    if (
      !contest ||
      contest.formatName !== 'final_submission' ||
      contestPhase(contest, now) !== 'ended'
    )
      return 0;
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
        ) {
          const ids = rows.map((row) => row.submissionId);
          await this.repository.requeue(ids);
          await this.commands.judge(ids);
          await Promise.all(
            rows.map((row) =>
              this.events.publish(submissionEvent(row, 'queued', 'QU')),
            ),
          );
          requeued += ids.length;
        }
      },
    );
    return requeued;
  }

  /** Every minute: ended FSO contests still holding pending rows (a lost delayed job, a submission stored at the last moment). */
  async sweep(now = new Date()): Promise<number> {
    let requeued = 0;
    for (const contestId of await this.repository.pendingContestIds())
      requeued += await this.judgeFinal(contestId, { isManual: false, now });
    return requeued;
  }
}
