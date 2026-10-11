import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;

@Schema({ ...baseSchemaOptions, collection: 'revisions' })
export class Revision {
  @IdProp() _id!: string;
  @Prop({ required: true }) entity!: string;
  @Prop({ type: UUID, required: true }) entityId!: string;
  @Prop({ required: true }) action!: string;
  @Prop({ type: UUID, default: null }) userId!: string | null;
  @Prop({ type: Object, default: {} }) changes!: Record<
    string,
    { before: unknown; after: unknown }
  >;
  @Prop({ default: '' }) comment!: string;
  createdAt!: Date;
}

export const RevisionSchema = SchemaFactory.createForClass(Revision);
RevisionSchema.index({ entity: 1, entityId: 1, createdAt: -1, _id: -1 });
// Lists of deleted entities (flatpages), newest first.
RevisionSchema.index(
  { entity: 1, createdAt: -1, _id: -1 },
  { partialFilterExpression: { action: 'delete' } },
);
// The global change log (`/admin/audit`), newest first, by actor or by kind.
RevisionSchema.index({ userId: 1, _id: -1 });
RevisionSchema.index({ entity: 1, _id: -1 });
