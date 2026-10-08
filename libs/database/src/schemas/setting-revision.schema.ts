import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;

/** One change of a setting; `before` and `after` are redacted (secrets are `{set: boolean}`). */
@Schema({ ...baseSchemaOptions, collection: 'settingRevisions' })
export class SettingRevision {
  @IdProp() _id!: string;
  @Prop({ required: true }) key!: string;
  @Prop({ type: MongooseSchema.Types.Mixed, default: null }) before!: unknown;
  @Prop({ type: MongooseSchema.Types.Mixed, default: null }) after!: unknown;
  @Prop({ type: [String], default: [] }) changedFields!: string[];
  @Prop({ type: UUID, default: null }) actor!: string | null;
  createdAt!: Date;
}
export const SettingRevisionSchema =
  SchemaFactory.createForClass(SettingRevision);
// One setting's history, newest first (UUIDv7 ids sort by time).
SettingRevisionSchema.index({ key: 1, _id: -1 });
