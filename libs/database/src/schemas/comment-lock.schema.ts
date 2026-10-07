import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { baseSchemaOptions, IdProp } from '../schema';
import { CommentPageRef, CommentPageRefSchema } from './comment.schema';

/** A locked page takes no new comments, except from `judge.override_comment_lock`. */
@Schema({ ...baseSchemaOptions, collection: 'commentLocks' })
export class CommentLock {
  @IdProp() _id!: string;
  @Prop({ type: CommentPageRefSchema, required: true }) page!: CommentPageRef;
}

export const CommentLockSchema = SchemaFactory.createForClass(CommentLock);
CommentLockSchema.index({ 'page.type': 1, 'page.id': 1 }, { unique: true });
