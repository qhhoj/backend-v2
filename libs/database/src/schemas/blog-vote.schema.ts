import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;

/** One row per voter and post; withdrawing a vote deletes it. */
@Schema({ ...baseSchemaOptions, collection: 'blogVotes' })
export class BlogVote {
  @IdProp() _id!: string;
  @Prop({ type: UUID, required: true }) blog!: string;
  @Prop({ type: UUID, required: true }) voter!: string;
  @Prop({ type: Number, required: true, enum: [-1, 1] }) score!: number;
}

export const BlogVoteSchema = SchemaFactory.createForClass(BlogVote);
BlogVoteSchema.index({ blog: 1, voter: 1 }, { unique: true });
