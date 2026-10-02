import { ModelDefinition } from '@nestjs/mongoose';
import { Group, GroupSchema } from './group.schema';
import { User, UserSchema } from './user.schema';

export * from './group.schema';
export * from './user.schema';
export const SCHEMAS: ModelDefinition[] = [
  { name: Group.name, schema: GroupSchema },
  { name: User.name, schema: UserSchema },
];
