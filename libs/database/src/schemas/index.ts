import { ModelDefinition } from '@nestjs/mongoose';
import { ActivationKey, ActivationKeySchema } from './activation-key.schema';
import { Group, GroupSchema } from './group.schema';
import { Language, LanguageSchema } from './language.schema';
import { License, LicenseSchema } from './license.schema';
import { ProblemGroup, ProblemGroupSchema } from './problem-group.schema';
import { Problem, ProblemSchema } from './problem.schema';
import { ProblemType, ProblemTypeSchema } from './problem-type.schema';
import { Revision, RevisionSchema } from './revision.schema';
import { User, UserSchema } from './user.schema';

export * from './activation-key.schema';
export * from './group.schema';
export * from './language.schema';
export * from './license.schema';
export * from './problem-data.schema';
export * from './problem-group.schema';
export * from './problem-type.schema';
export * from './problem.schema';
export * from './revision.schema';
export * from './user.schema';
export const SCHEMAS: ModelDefinition[] = [
  { name: ActivationKey.name, schema: ActivationKeySchema },
  { name: Group.name, schema: GroupSchema },
  { name: Language.name, schema: LanguageSchema },
  { name: License.name, schema: LicenseSchema },
  { name: ProblemGroup.name, schema: ProblemGroupSchema },
  { name: Problem.name, schema: ProblemSchema },
  { name: ProblemType.name, schema: ProblemTypeSchema },
  { name: Revision.name, schema: RevisionSchema },
  { name: User.name, schema: UserSchema },
];
