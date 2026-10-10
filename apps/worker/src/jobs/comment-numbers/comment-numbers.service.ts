import { Injectable, Logger } from '@nestjs/common';
import { CommentNumbersRepository } from './comment-numbers.repository';

/** Gives the comments posted before `Comment.number` existed their per-page numbers. New comments take theirs from the page counter at posting; a page's counter is seeded with its comment count before its old rows are numbered 1..count, so both never collide. */
@Injectable()
export class CommentNumbersService {
  private readonly logger = new Logger(CommentNumbersService.name);

  constructor(private readonly repository: CommentNumbersRepository) {}

  async backfill(): Promise<{ pages: number; comments: number }> {
    const pages = await this.repository.pagesToNumber();
    let comments = 0;
    for (const page of pages) {
      await this.repository.seedCounter(page);
      comments += await this.repository.numberUnnumbered(page);
    }
    this.logger.log(
      `comment numbers backfill: ${comments} comments on ${pages.length} pages`,
    );
    return { pages: pages.length, comments };
  }
}
