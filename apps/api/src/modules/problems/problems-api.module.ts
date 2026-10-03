import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { LanguagesQuerier } from './languages.querier';
import { LicensesQuerier } from './licenses.querier';
import { ProblemGroupsQuerier } from './problem-groups.querier';
import { ProblemTypesQuerier } from './problem-types.querier';
import { ProblemsController } from './problems.controller';
import { ProblemsService } from './problems.service';

const queriers = [
  ProblemTypesQuerier,
  ProblemGroupsQuerier,
  LicensesQuerier,
  LanguagesQuerier,
];

@Module({
  imports: [AuthModule],
  controllers: [ProblemsController],
  providers: [...queriers, ProblemsService],
  exports: [...queriers],
})
export class ProblemsApiModule {}
