import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;

export const TICKET_CANNED_REPLY_TITLE_MAX = 60;
export const TICKET_CANNED_REPLY_BODY_MAX = 8192;

/** A staff-written answer to insert into a ticket reply. `{tên}` and `{bài}` are replaced by the SPA at insertion; the text is stored verbatim. */
@Schema({ ...baseSchemaOptions, collection: 'ticketCannedReplies' })
export class TicketCannedReply {
  @IdProp() _id!: string;
  @Prop({
    required: true,
    minlength: 1,
    maxlength: TICKET_CANNED_REPLY_TITLE_MAX,
  })
  title!: string;
  @Prop({
    required: true,
    minlength: 1,
    maxlength: TICKET_CANNED_REPLY_BODY_MAX,
  })
  body!: string;
  /** Ascending; ties by id. */
  @Prop({ default: 0, min: 0 }) order!: number;
  @Prop({ type: UUID, required: true }) createdBy!: string;
  createdAt!: Date;
  updatedAt!: Date;
}

export const TicketCannedReplySchema =
  SchemaFactory.createForClass(TicketCannedReply);
// The picker lists them in order.
TicketCannedReplySchema.index({ order: 1, _id: 1 });
