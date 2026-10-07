import { Prop } from '@nestjs/mongoose';
import { CollationOptions } from 'mongodb';
import { Schema, SchemaOptions } from 'mongoose';
import { newId, uuidStr } from './uuid';

export const CI: CollationOptions = { locale: 'en', strength: 2 };

// Subdocument schemas with an _id need `id: false`, or getters expose an `id` virtual.
export const baseSchemaOptions: SchemaOptions = {
  id: false,
  timestamps: true,
  versionKey: false,
  toJSON: {
    getters: true,
    transform: (doc, ret: Record<string, unknown>) => {
      delete ret._id;
      return { id: uuidStr(doc.get('_id')), ...ret };
    },
  },
};

export const IdProp = () => Prop({ type: Schema.Types.UUID, default: newId });

export const ciIndex = (schema: Schema, field: string, unique = true) =>
  schema.index({ [field]: 1 }, { unique, collation: CI });

/** For `Mixed` props typed as a record: rejects null, arrays and scalars. */
export const PLAIN_OBJECT = {
  validator: (value: unknown) =>
    typeof value === 'object' && value !== null && !Array.isArray(value),
  message: '{PATH} must be an object',
};
