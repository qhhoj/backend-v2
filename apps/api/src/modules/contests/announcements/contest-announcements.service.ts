import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Principal } from '@libs/auth';
import { AppError, Paginated, RateLimitService } from '@libs/common';
import {
  NOTIFICATION_FANOUT_QUEUE,
  notifyAnnouncementFanout,
} from '@libs/community';
import type { NotificationFanoutJob } from '@libs/community';
import { contestPhase, problemLabel } from '@libs/contests';
import { uuidStr } from '@libs/database';
import { renderMarkdown, RenderLimitError } from '@libs/render';
import type { ProblemLinks } from '@libs/render';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import { AnnouncementsRepository } from './announcements.repository';
import { ContestEventsService } from './contest-events.service';
import { ContestsService } from '../core/contests.service';
import type { ContestDocument } from '../core/contests.repository';
import type {
  AnnouncementListQueryDto,
  CreateAnnouncementDto,
} from './dto/announcement.dto';
import { AnnouncementResponse } from './dto/announcement.response';
import {
  ANNOUNCEMENT_PUSH_LIMIT,
  ANNOUNCEMENT_PUSH_WINDOW_SECONDS,
} from '../core/rate-limits';

@Injectable()
export class ContestAnnouncementsService {
  private readonly logger = new Logger(ContestAnnouncementsService.name);

  constructor(
    private readonly contestsService: ContestsService,
    private readonly announcements: AnnouncementsRepository,
    private readonly events: ContestEventsService,
    private readonly rateLimit: RateLimitService,
    private readonly problems: ProblemsRepository,
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE)
    private readonly fanout: Queue<NotificationFanoutJob>,
  ) {}

  async list(
    principal: Principal | null,
    key: string,
    query: AnnouncementListQueryDto,
  ): Promise<Paginated<AnnouncementResponse>> {
    const contest = await this.contestsService.visibleContest(principal, key);
    const { items, total } = await this.announcements.list(
      contest._id,
      query.page,
      query.pageSize,
    );
    return new Paginated(
      items.map((item) => AnnouncementResponse.from(item)),
      {
        page: query.page,
        pageSize: query.pageSize,
        total,
      },
    );
  }

  /** Legacy `ContestAnnounce`: stored, then pushed when the contest pushes announcements. */
  async create(
    principal: Principal,
    key: string,
    dto: CreateAnnouncementDto,
  ): Promise<AnnouncementResponse> {
    const contest = await this.contestsService.editableContest(principal, key);
    const descriptionHtml = await this.render(contest, dto.description);
    if (contest.pushAnnouncements) await this.spendPush(contest._id);
    const announcement = await this.announcements.create({
      contest: contest._id,
      title: dto.title,
      description: dto.description,
      descriptionHtml,
    });
    await this.push(contest, announcement._id);
    return AnnouncementResponse.from(announcement);
  }

  /** Legacy admin `resend_view`: pushes again to the open streams; inboxes keep one entry per announcement, so only users the first fan-out missed are notified. */
  async resend(principal: Principal, key: string, id: string): Promise<void> {
    const contest = await this.contestsService.editableContest(principal, key);
    if (!(await this.announcements.findInContest(contest._id, id)))
      throw new AppError('not_found', 404, 'No such announcement');
    if (contest.pushAnnouncements) await this.spendPush(contest._id);
    await this.push(contest, id);
  }

  /** Fixes the text in place: the post keeps its time and is not pushed again (resend does that). */
  async update(
    principal: Principal,
    key: string,
    id: string,
    dto: CreateAnnouncementDto,
  ): Promise<AnnouncementResponse> {
    const contest = await this.contestsService.editableContest(principal, key);
    const updated = await this.announcements.updateInContest(contest._id, id, {
      title: dto.title,
      description: dto.description,
      descriptionHtml: await this.render(contest, dto.description),
    });
    if (!updated) throw new AppError('not_found', 404, 'No such announcement');
    return AnnouncementResponse.from(updated);
  }

  /** The composer's preview, rendered as `create` would store it; contest editors only. */
  async preview(
    principal: Principal,
    key: string,
    description: string,
  ): Promise<{ html: string }> {
    const contest = await this.contestsService.editableContest(principal, key);
    return { html: await this.render(contest, description) };
  }

  async remove(principal: Principal, key: string, id: string): Promise<void> {
    const contest = await this.contestsService.editableContest(principal, key);
    if (!(await this.announcements.deleteInContest(contest._id, id)))
      throw new AppError('not_found', 404, 'No such announcement');
  }

  /** Shown live on the contest stream, and written to the inboxes by the fan-out job. */
  private async push(
    contest: ContestDocument,
    announcementId: string,
  ): Promise<void> {
    if (!contest.pushAnnouncements) return;
    await this.events.publish({
      type: 'announcement',
      contestId: contest._id,
      announcementId,
    });
    await notifyAnnouncementFanout(this.fanout, announcementId, this.logger);
  }

  /** Every push reaches every open stream of the contest: bounded per contest, never given back. */
  private async spendPush(contestId: string): Promise<void> {
    await this.rateLimit.reserve(
      [`announcement-push:${contestId}`],
      ANNOUNCEMENT_PUSH_LIMIT,
      ANNOUNCEMENT_PUSH_WINDOW_SECONDS,
    );
  }

  /** `#C` links to the contest's problem labelled C. */
  private async render(
    contest: ContestDocument,
    text: string,
  ): Promise<string> {
    const problemLinks = await this.problemLinks(contest);
    try {
      return renderMarkdown(text, 'problem', { problemLinks });
    } catch (error) {
      if (!(error instanceof RenderLimitError)) throw error;
      throw new AppError('validation_failed', 400, error.message, {
        description: [error.message],
      });
    }
  }

  /** Label → problem page of the contest's problems, labelled in contest order like the problem list. None before the start: the stored HTML must not reveal hidden problem codes. Resolved when the text is saved, so a later reorder does not move old links. */
  private async problemLinks(
    contest: ContestDocument,
  ): Promise<ProblemLinks | undefined> {
    if (contestPhase(contest, new Date()) === 'upcoming') return undefined;
    const ordered = [...contest.problems].sort(
      (left, right) => left.order - right.order,
    );
    const summaries = await this.problems.findSummaries(
      ordered.map((entry) => uuidStr(entry.problem)),
    );
    const codeOf = new Map(
      summaries.map((summary) => [uuidStr(summary._id), summary.code]),
    );
    const links: Record<string, string> = {};
    ordered.forEach((entry, index) => {
      const code = codeOf.get(uuidStr(entry.problem));
      if (code)
        links[problemLabel(index, contest.labelStyle)] =
          `/problems/${encodeURIComponent(code)}`;
    });
    return links;
  }
}
