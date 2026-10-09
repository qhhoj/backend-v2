import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

/** Hostname-style, as the judge-server sends it in its handshake `id`. */
export const JUDGE_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,50}$/;

@Schema({ _id: false })
export class JudgeRuntime {
  /** Language key (`CPP17`), as the judge reports its executors. */
  @Prop({ required: true }) language!: string;
  @Prop({ required: true }) name!: string;
  @Prop({ default: '' }) version!: string;
  @Prop({ default: 0 }) priority!: number;
}

/** Legacy `Judge` + `RuntimeVersion`; the online fields are written only by the bridge. */
@Schema({ ...baseSchemaOptions, collection: 'judges' })
export class Judge {
  @IdProp() _id!: string;
  @Prop({ required: true, match: JUDGE_NAME_PATTERN }) name!: string;
  /** sha256 hex of the key; the key itself is shown once, at creation or rotation. */
  @Prop({ required: true }) authKeyHash!: string;
  @Prop({ default: false }) isBlocked!: boolean;
  @Prop({ default: false }) isDisabled!: boolean;
  @Prop({ default: '' }) description!: string;
  @Prop({ default: false }) online!: boolean;
  @Prop({ type: Date, default: null }) startTime!: Date | null;
  @Prop({ type: Number, default: null }) ping!: number | null;
  @Prop({ type: Number, default: null }) load!: number | null;
  @Prop({ type: String, default: null }) lastIp!: string | null;
  /** Problem codes the judge reported (handshake or `supported-problems`). */
  @Prop({ type: [String], default: [] }) problems!: string[];
  @Prop({ type: [SchemaFactory.createForClass(JudgeRuntime)], default: [] })
  runtimes!: JudgeRuntime[];
  /** Assignments the judge runs at once (`Hello.slots`); kept after it goes offline. */
  @Prop({ default: 0 }) slots!: number;
  /** Slots in use at its last pong; 0 while offline. */
  @Prop({ default: 0 }) busy!: number;
  /** The judge's build string from Hello. */
  @Prop({ default: '' }) build!: string;
  /** Protocol minor the judge speaks (`Hello.protocolMinor`). */
  @Prop({ default: 0 }) protocolMinor!: number;
  /** Optional features the judge reports (`interactive`, `file_io`, `checker.testlib`, ...). */
  @Prop({ type: [String], default: [] }) features!: string[];
}
export const JudgeSchema = SchemaFactory.createForClass(Judge);
JudgeSchema.index({ name: 1 }, { unique: true });
