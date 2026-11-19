import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;

/** Every kind of object a `revisions` row records; the audit log lists each one. */
export const REVISION_ENTITIES = [
  'problem',
  'tagProblem',
  'problemType',
  'problemGroup',
  'license',
  'contest',
  'contestParticipation',
  'submission',
  'submission_batch',
  'user',
  'group',
  'organization',
  'blogPost',
  'comment',
  'flatpage',
  'judge',
  'share',
  'ticket',
  'miscConfig',
] as const;
export type RevisionEntity = (typeof REVISION_ENTITIES)[number];

@Schema({ ...baseSchemaOptions, collection: 'revisions' })
export class Revision {
  @IdProp() _id!: string;
  @Prop({ type: String, required: true }) entity!: RevisionEntity;
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
