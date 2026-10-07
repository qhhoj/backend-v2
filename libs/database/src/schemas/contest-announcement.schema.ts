import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;

export const ANNOUNCEMENT_TITLE_MAX = 100;

@Schema({ ...baseSchemaOptions, collection: 'contestAnnouncements' })
export class ContestAnnouncement {
  @IdProp() _id!: string;
  @Prop({ type: UUID, required: true }) contest!: string;
  @Prop({ required: true, minlength: 1, maxlength: ANNOUNCEMENT_TITLE_MAX })
  title!: string;
  @Prop({ default: '' }) description!: string;
  @Prop({ default: '' }) descriptionHtml!: string;
  createdAt!: Date;
}

export const ContestAnnouncementSchema =
  SchemaFactory.createForClass(ContestAnnouncement);
// A contest's announcements newest first (ids are time-ordered).
ContestAnnouncementSchema.index({ contest: 1, _id: -1 });
