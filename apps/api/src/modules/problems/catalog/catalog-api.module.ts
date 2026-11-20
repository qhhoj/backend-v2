import { Module } from '@nestjs/common';
import { LanguagesQuerier } from './languages.querier';
import { LicensesQuerier } from './licenses.querier';
import { ProblemGroupsQuerier } from './problem-groups.querier';
import { ProblemTypesQuerier } from './problem-types.querier';

const queriers = [
  ProblemTypesQuerier,
  ProblemGroupsQuerier,
  LicensesQuerier,
  LanguagesQuerier,
];

/** The cached catalogs (languages, problem types, groups, licenses): one instance each, so an admin edit refreshes the copy every module reads. Import this, not the problems module, to read a catalog. */
@Module({ providers: queriers, exports: queriers })
export class CatalogApiModule {}
