import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { ContestAccessModule } from '../core/contest-access.module';

/** The ICPC event feed and its keys. */
@Module({ imports: [AuthModule, ContestAccessModule] })
export class FeedModule {}
