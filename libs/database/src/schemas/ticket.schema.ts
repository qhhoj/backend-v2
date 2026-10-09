import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;

export const TICKET_LINK_TYPES = ['problem', 'general'] as const;
export type TicketLinkType = (typeof TICKET_LINK_TYPES)[number];

/** Legacy generic foreign key: a problem by id, or a `generalIssues` row. */
@Schema({ _id: false })
export class TicketLinkRef {
  @Prop({ type: String, required: true, enum: [...TICKET_LINK_TYPES] })
  type!: TicketLinkType;
  @Prop({ type: UUID, required: true }) id!: string;
}
export const TicketLinkRefSchema = SchemaFactory.createForClass(TicketLinkRef);

/** Legacy `TicketMessage`, embedded. */
@Schema({ id: false })
export class TicketMessage {
  @IdProp() _id!: string;
  @Prop({ type: UUID, required: true }) user!: string;
  @Prop({ required: true, minlength: 1, maxlength: 8192 }) body!: string;
  /** `body` rendered at save in the `user` style. */
  @Prop({ default: '' }) bodyHtml!: string;
  @Prop({ type: Date, default: () => new Date() }) createdAt!: Date;
}
export const TicketMessageSchema = SchemaFactory.createForClass(TicketMessage);

export const TICKET_TIMELINE_TYPES = [
  'closed',
  'reopened',
  'assigned',
  'unassigned',
  'marked-good',
  'unmarked-good',
] as const;
export type TicketTimelineType = (typeof TICKET_TIMELINE_TYPES)[number];

/** One state change of a ticket, embedded; the thread shows it between the messages. */
@Schema({ id: false })
export class TicketTimelineEvent {
  @IdProp() _id!: string;
  @Prop({ type: String, required: true, enum: [...TICKET_TIMELINE_TYPES] })
  type!: TicketTimelineType;
  /** Who did it. */
  @Prop({ type: UUID, required: true }) user!: string;
  @Prop({ type: Date, required: true }) at!: Date;
  /** The assignee of `assigned` / `unassigned`, else null. */
  @Prop({ type: UUID, default: null }) target!: string | null;
}
export const TicketTimelineEventSchema =
  SchemaFactory.createForClass(TicketTimelineEvent);

@Schema({ ...baseSchemaOptions, collection: 'tickets' })
export class Ticket {
  @IdProp() _id!: string;
  @Prop({ required: true, maxlength: 100 }) title!: string;
  @Prop({ type: UUID, required: true }) user!: string;
  @Prop({ type: [UUID], default: [] }) assignees!: string[];
  /** Notes of assignees and staff; read by every reader of the ticket, edited by assignees and `change_ticket` holders. */
  @Prop({ default: '' }) notes!: string;
  @Prop({ type: TicketLinkRefSchema, required: true })
  linkedItem!: TicketLinkRef;
  /** A "good" ticket: worth 10 contribution points to its creator. */
  @Prop({ default: false }) isContributive!: boolean;
  @Prop({ default: true }) isOpen!: boolean;
  /** At most 500 (the `$push` filter enforces it). */
  @Prop({ type: [TicketMessageSchema], default: [] })
  messages!: TicketMessage[];
  /** Denormalized so lists never load `messages`. */
  @Prop({ default: 0 }) messageCount!: number;
  @Prop({ type: Date, default: () => new Date() }) lastMessageAt!: Date;
  /** The newest 200 state changes, oldest first (every `$push` slices to 200, so a full timeline never refuses a change). */
  @Prop({ type: [TicketTimelineEventSchema], default: [] })
  events!: TicketTimelineEvent[];
  /** Whether the newest message came from a `change_ticket` holder; stored because staff status changes over time. */
  @Prop({ default: false }) lastMessageByStaff!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}

export const TicketSchema = SchemaFactory.createForClass(Ticket);
// Lists newest first: own tickets, assigned tickets, a problem's tickets, open tickets.
TicketSchema.index({ user: 1, _id: -1 });
TicketSchema.index({ assignees: 1, _id: -1 });
TicketSchema.index({ 'linkedItem.id': 1, _id: -1 });
TicketSchema.index({ isOpen: 1, _id: -1 });
// Good tickets of a user (contribution points).
TicketSchema.index({ user: 1, isContributive: 1 });
// Open tickets waiting for staff (the summary count).
TicketSchema.index({ isOpen: 1, lastMessageByStaff: 1 });
