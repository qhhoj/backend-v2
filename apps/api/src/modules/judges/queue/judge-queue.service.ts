import { Injectable } from '@nestjs/common';
import { uuidStr } from '@libs/database';
import { JudgesRepository } from '../judges.repository';
import type { JudgeListRow } from '../judges.repository';
import type {
  JudgeQueueResponse,
  QueueLanguageResponse,
  QueuePinnedResponse,
} from './dto/judge-queue.response';
import { JudgeQueueRepository } from './judge-queue.repository';
import type { KeyCount } from './judge-queue.repository';

/** Connected judges that take work: blocked ones are refused, disabled ones take none. */
const usableOnline = (judges: JudgeListRow[]): JudgeListRow[] =>
  judges.filter(
    (judge) => judge.online && !judge.isBlocked && !judge.isDisabled,
  );

/** Legacy judge status page and the admin QU/P/G filter: what waits, at which priority, and whether any judge can drain it. */
@Injectable()
export class JudgeQueueService {
  constructor(
    private readonly queue: JudgeQueueRepository,
    private readonly judges: JudgesRepository,
  ) {}

  async summary(): Promise<JudgeQueueResponse> {
    const [statuses, byPriority, languages, pinned, judges] = await Promise.all(
      [
        this.queue.statusCounts(),
        this.queue.byPriority(),
        this.queue.byLanguage(),
        this.queue.byPinnedJudge(),
        this.judges.list(),
      ],
    );
    const countOf = (status: string) =>
      statuses.find((row) => row.status === status)?.count ?? 0;
    const oldest = byPriority.length
      ? Math.min(...byPriority.map((row) => row.oldestSince.getTime()))
      : null;
    return {
      queued: countOf('QU'),
      processing: countOf('P'),
      grading: countOf('G'),
      oldestQueuedSince: oldest === null ? null : new Date(oldest),
      byPriority,
      byLanguage: await this.languageRows(languages, usableOnline(judges)),
      pinned: pinnedRows(pinned, judges),
    };
  }

  private async languageRows(
    counts: KeyCount[],
    online: JudgeListRow[],
  ): Promise<QueueLanguageResponse[]> {
    const languages = new Map(
      (await this.queue.languagesByIds(counts.map((row) => row.key))).map(
        (language) => [uuidStr(language._id), language],
      ),
    );
    return counts.map(({ key: id, count }) => {
      const language = languages.get(id);
      const key = language?.key ?? null;
      return {
        id,
        key,
        name: language?.name ?? null,
        count,
        onlineJudges: online.filter((judge) =>
          judge.runtimes.some((runtime) => runtime.language === key),
        ).length,
      };
    });
  }
}

function pinnedRows(
  counts: KeyCount[],
  judges: JudgeListRow[],
): QueuePinnedResponse[] {
  const online = new Set(usableOnline(judges).map((judge) => judge.name));
  return counts.map(({ key, count }) => ({
    judge: key,
    count,
    online: online.has(key),
  }));
}
