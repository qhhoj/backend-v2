import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CONTEST_MOSS_QUEUE } from '@libs/contests';
import { ContestMossProcessor } from './contest-moss.processor';
import { ContestMossRepository } from './contest-moss.repository';
import { ContestMossService } from './contest-moss.service';
import { DEFAULT_MOSS_SERVER, MOSS_SERVER } from './moss-client';

@Module({
  imports: [BullModule.registerQueue({ name: CONTEST_MOSS_QUEUE })],
  providers: [
    ContestMossProcessor,
    ContestMossService,
    ContestMossRepository,
    { provide: MOSS_SERVER, useValue: DEFAULT_MOSS_SERVER },
  ],
})
export class ContestMossModule {}
