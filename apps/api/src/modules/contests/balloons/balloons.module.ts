import { Module } from '@nestjs/common';
import { ProblemsApiModule } from '../../problems/problems-api.module';
import { ContestAccessModule } from '../core/contest-access.module';

/** The on-site balloon queue. */
@Module({ imports: [ContestAccessModule, ProblemsApiModule] })
export class BalloonsModule {}
