import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { COMMENT_NUMBERS_QUEUE } from '@libs/community';
import { CommentNumbersProcessor } from './comment-numbers.processor';
import { CommentNumbersRepository } from './comment-numbers.repository';
import { CommentNumbersService } from './comment-numbers.service';

@Module({
  imports: [BullModule.registerQueue({ name: COMMENT_NUMBERS_QUEUE })],
  providers: [
    CommentNumbersProcessor,
    CommentNumbersService,
    CommentNumbersRepository,
  ],
})
export class CommentNumbersModule {}
