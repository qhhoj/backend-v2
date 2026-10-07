import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;

/** One per contest submission; `_id` is the submission's id. */
@Schema({ ...baseSchemaOptions, collection: 'contestSubmissions' })
export class ContestSubmission {
  @IdProp() _id!: string;
  @Prop({ type: UUID, required: true }) participation!: string;
  @Prop({ type: UUID, required: true }) contest!: string;
  /** The contest problem's problem id. */
  @Prop({ type: UUID, required: true }) problem!: string;
  /** Case ratio × the contest problem's points (legacy `update_contest`). */
  @Prop({ default: 0 }) points!: number;
  /** Judged on pretests only (`runPretestsOnly` and the problem's `isPretested` when submitted). */
  @Prop({ default: false }) isPretest!: boolean;
}

export const ContestSubmissionSchema =
  SchemaFactory.createForClass(ContestSubmission);
ContestSubmissionSchema.index({ participation: 1, problem: 1 });
ContestSubmissionSchema.index({ contest: 1, problem: 1 });
