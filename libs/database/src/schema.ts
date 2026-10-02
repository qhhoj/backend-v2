import { Prop } from '@nestjs/mongoose';
import { CollationOptions } from 'mongodb';
import { Schema, SchemaOptions } from 'mongoose';
import { newId, uuidStr } from './uuid';

export const CI: CollationOptions = { locale: 'en', strength: 2 };

export const baseSchemaOptions: SchemaOptions = {
  timestamps: true,
  versionKey: false,
  toJSON: {
    transform: (doc, ret: Record<string, unknown>) => {
      delete ret._id;
      return { id: uuidStr(doc.get('_id')), ...ret };
    },
  },
};

export const IdProp = () => Prop({ type: Schema.Types.UUID, default: newId });

export const ciIndex = (schema: Schema, field: string, unique = true) =>
  schema.index({ [field]: 1 }, { unique, collation: CI });
