import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** A one-off data migration that finished (`worker migrate`); its id is never run again. */
@Schema({ collection: 'migrations', versionKey: false })
export class MigrationRecord {
  @Prop({ type: String }) _id!: string;
  @Prop({ type: Date, required: true }) at!: Date;
}
export const MigrationRecordSchema =
  SchemaFactory.createForClass(MigrationRecord);
