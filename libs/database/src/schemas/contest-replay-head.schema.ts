import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;

@Schema({ _id: false })
export class ReplayParticipant {
  @Prop({ type: UUID, required: true }) participationId!: string;
  @Prop({ type: UUID, required: true }) userId!: string;
}
export const ReplayParticipantSchema =
  SchemaFactory.createForClass(ReplayParticipant);

@Schema({ _id: false })
export class ReplayProblem {
  @Prop({ type: UUID, required: true }) problemId!: string;
  @Prop({ required: true, min: 0 }) points!: number;
}
export const ReplayProblemSchema = SchemaFactory.createForClass(ReplayProblem);

@Schema({ _id: false })
export class ReplayGhost {
  @Prop({ required: true, maxlength: 64 }) label!: string;
  @Prop({ default: '', maxlength: 64 }) caption!: string;
  @Prop({ required: true }) isUnranked!: boolean;
  /** 'points' | 'rejectedBefore' | null (`GhostGap`); no enum validator, which would reject the null. */
  @Prop({ type: String, default: null }) gap!:
    'points' | 'rejectedBefore' | null;
}
export const ReplayGhostSchema = SchemaFactory.createForClass(ReplayGhost);

/** The pointer to a complete replay build, written last; readers see the previous build until it is replaced. */
@Schema({ ...baseSchemaOptions, collection: 'contestReplayHeads' })
export class ContestReplayHead {
  /** The contest's id: one head per contest. */
  @IdProp() _id!: string;
  @Prop({ type: UUID, required: true }) buildId!: string;
  @Prop({ type: Date, required: true }) builtAt!: Date;
  /** `REPLAY_FORMAT_VERSION` at build time; a reader refuses a head of another version. */
  @Prop({ required: true, min: 1 }) formatVersion!: number;
  /** Chunks of the `real` stream; at least 1 (chunk 0 exists even for an empty replay). */
  @Prop({ required: true, min: 0 }) chunkCount!: number;
  /** Chunks of the `ghost` stream (0 without ghosts). */
  @Prop({ required: true, min: 0 }) ghostChunkCount!: number;
  /** In event `participantIndex` order. */
  @Prop({ type: [ReplayParticipantSchema], default: [] })
  participants!: ReplayParticipant[];
  /** In event `problemIndex` order (contest order). */
  @Prop({ type: [ReplayProblemSchema], default: [] })
  problems!: ReplayProblem[];
  /** Ranked ghosts first, then unranked, each group by label; a ghost's `participantIndex` is its position here. Their events are the `ghost` stream. */
  @Prop({ type: [ReplayGhostSchema], default: [] }) ghosts!: ReplayGhost[];
}
export const ContestReplayHeadSchema =
  SchemaFactory.createForClass(ContestReplayHead);
