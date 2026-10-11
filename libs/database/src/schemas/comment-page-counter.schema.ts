import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { baseSchemaOptions, IdProp } from '../schema';
import { CommentPageRef, CommentPageRefSchema } from './comment.schema';

/** The last `Comment.number` handed out on a page. Seeded with the page's comment count on first use, so rows posted earlier keep 1..count. */
@Schema({ ...baseSchemaOptions, collection: 'commentPageCounters' })
export class CommentPageCounter {
  @IdProp() _id!: string;
  @Prop({ type: CommentPageRefSchema, required: true }) page!: CommentPageRef;
  @Prop({ required: true, min: 0 }) seq!: number;
}

export const CommentPageCounterSchema =
  SchemaFactory.createForClass(CommentPageCounter);
CommentPageCounterSchema.index(
  { 'page.type': 1, 'page.id': 1 },
  { unique: true },
);
