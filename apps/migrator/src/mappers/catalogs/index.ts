import { Type } from '@nestjs/common';
import { Mapper } from '../../mapper';
import { LanguagesMapper } from './languages.mapper';
import { LicensesMapper } from './licenses.mapper';
import { ProblemGroupsMapper } from './problem-groups.mapper';
import { ProblemTypesMapper } from './problem-types.mapper';
import { TagGroupsMapper } from './tag-groups.mapper';
import { TagProblemsMapper } from './tag-problems.mapper';
import { TagsMapper } from './tags.mapper';

/** This area's backfill jobs in run order. `judges` is not migrated: judge-v2 registers judges fresh. */
export const CATALOG_MAPPERS: Type<Mapper>[] = [
  ProblemTypesMapper,
  ProblemGroupsMapper,
  LicensesMapper,
  TagGroupsMapper,
  TagsMapper,
  TagProblemsMapper,
  LanguagesMapper,
];
