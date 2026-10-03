import { ModelDefinition } from '@nestjs/mongoose';
import { ActivationKey, ActivationKeySchema } from './activation-key.schema';
import { Group, GroupSchema } from './group.schema';
import { Language, LanguageSchema } from './language.schema';
import { License, LicenseSchema } from './license.schema';
import { ProblemGroup, ProblemGroupSchema } from './problem-group.schema';
import { ProblemType, ProblemTypeSchema } from './problem-type.schema';
import { User, UserSchema } from './user.schema';

export * from './activation-key.schema';
export * from './group.schema';
export * from './language.schema';
export * from './license.schema';
export * from './problem-group.schema';
export * from './problem-type.schema';
export * from './user.schema';
export const SCHEMAS: ModelDefinition[] = [
  { name: ActivationKey.name, schema: ActivationKeySchema },
  { name: Group.name, schema: GroupSchema },
  { name: Language.name, schema: LanguageSchema },
  { name: License.name, schema: LicenseSchema },
  { name: ProblemGroup.name, schema: ProblemGroupSchema },
  { name: ProblemType.name, schema: ProblemTypeSchema },
  { name: User.name, schema: UserSchema },
];
