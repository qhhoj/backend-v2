import type { Provider, Type } from '@nestjs/common';
import { ProblemTagsController } from './problem-tags.controller';
import { ProblemTagsRepository } from './problem-tags.repository';
import { ProblemTagsService } from './problem-tags.service';

/** Controllers and providers of the problem-tag catalogue. A lane adds its classes here, so `organizations-api.module.ts` is never edited by two lanes. */
export const PROBLEM_TAG_CONTROLLERS: Type[] = [ProblemTagsController];
export const PROBLEM_TAG_PROVIDERS: Provider[] = [
  ProblemTagsRepository,
  ProblemTagsService,
];
