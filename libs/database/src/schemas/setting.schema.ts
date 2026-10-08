import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';

const UUID = MongooseSchema.Types.UUID;

/** A runtime setting; `_id` is the registry key (`libs/settings/src/registry.ts`), `value` is sealed when the key holds secrets. Never deleted. */
@Schema({ collection: 'settings', versionKey: false })
export class Setting {
  @Prop({ type: String, required: true }) _id!: string;
  @Prop({ type: MongooseSchema.Types.Mixed, required: true }) value!: unknown;
  @Prop({ type: UUID, default: null }) updatedBy!: string | null;
  @Prop({ type: Date, required: true }) updatedAt!: Date;
}
export const SettingSchema = SchemaFactory.createForClass(Setting);
