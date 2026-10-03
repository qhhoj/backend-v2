import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { ApiV2ProblemsController } from './api-v2-problems.controller';
import { ApiV2ProblemsService } from './api-v2-problems.service';

@Module({
  imports: [AuthModule, ProblemsApiModule],
  controllers: [ApiV2ProblemsController],
  providers: [ApiV2ProblemsService],
})
export class ApiV2Module {}
