import { ModelDefinition } from '@nestjs/mongoose';
import { Group, GroupSchema } from './group.schema';

export * from './group.schema';
export const SCHEMAS: ModelDefinition[] = [
  { name: Group.name, schema: GroupSchema },
];
