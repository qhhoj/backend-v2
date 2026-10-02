import { ModelDefinition } from '@nestjs/mongoose';
import { ActivationKey, ActivationKeySchema } from './activation-key.schema';
import { Group, GroupSchema } from './group.schema';
import { User, UserSchema } from './user.schema';

export * from './activation-key.schema';
export * from './group.schema';
export * from './user.schema';
export const SCHEMAS: ModelDefinition[] = [
  { name: ActivationKey.name, schema: ActivationKeySchema },
  { name: Group.name, schema: GroupSchema },
  { name: User.name, schema: UserSchema },
];
