import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;

/** One row per voter and comment; withdrawing a vote deletes it. */
@Schema({ ...baseSchemaOptions, collection: 'commentVotes' })
export class CommentVote {
  @IdProp() _id!: string;
  @Prop({ type: UUID, required: true }) comment!: string;
  @Prop({ type: UUID, required: true }) voter!: string;
  @Prop({ type: Number, required: true, enum: [-1, 1] }) score!: number;
}

export const CommentVoteSchema = SchemaFactory.createForClass(CommentVote);
CommentVoteSchema.index({ comment: 1, voter: 1 }, { unique: true });
