import type { ModelDefinition } from '@nestjs/mongoose';
import { Schema } from 'mongoose';
import * as schemas from './index';

/** Every model, from the schema files: an exported `<Model>Schema` that names its `collection` (sub-documents name none). */
export const SCHEMAS: ModelDefinition[] = Object.entries(schemas).flatMap(
  ([name, value]) =>
    value instanceof Schema &&
    name.endsWith('Schema') &&
    value.get('collection')
      ? [{ name: name.slice(0, -'Schema'.length), schema: value }]
      : [],
);
