import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;
const Mixed = MongooseSchema.Types.Mixed;

/** One slice of a build's event stream, at most `REPLAY_CHUNK_EVENTS` tuples (`@libs/contests`). `minimize: false` keeps empty cells stored. */
@Schema({
  ...baseSchemaOptions,
  collection: 'contestReplayChunks',
  minimize: false,
})
export class ContestReplayChunk {
  @IdProp() _id!: string;
  @Prop({ type: UUID, required: true }) contest!: string;
  @Prop({ type: UUID, required: true }) buildId!: string;
  /** `real`: the participants' events; `ghost`: the ghosts' events. */
  @Prop({ type: String, enum: ['real', 'ghost'], default: 'real' }) stream!:
    'real' | 'ghost';
  @Prop({ required: true, min: 0 }) chunk!: number;
  /** `[seconds, participantIndex, problemIndex, cell, score, cumtime, tiebreaker]` tuples. */
  @Prop({ type: Mixed, required: true }) events!: unknown[][];
}
export const ContestReplayChunkSchema =
  SchemaFactory.createForClass(ContestReplayChunk);
ContestReplayChunkSchema.index(
  { contest: 1, buildId: 1, stream: 1, chunk: 1 },
  { unique: true },
);
