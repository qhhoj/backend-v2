import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';

const UUID = MongooseSchema.Types.UUID;

/** A site language and the remote OJ's language id it is sent as. */
@Schema({ _id: false })
export class ExternalLanguage {
  @Prop({ type: UUID, required: true }) language!: string;
  @Prop({ required: true }) remoteId!: string;
  @Prop({ default: '' }) remoteName!: string;
}

/** A problem judged by a remote OJ through the external judge (PCD VJudge) instead of judge-v2. While `isActive`, the bridge never queues its submissions for a judge and `allowedLanguages` are the mapped languages. */
@Schema({ _id: false })
export class ExternalJudgeLink {
  @Prop({ default: true }) isActive!: boolean;
  /** The external judge's OJ id (`CodeForces`, `QOJ`, `OJUZ`, ...). */
  @Prop({ required: true }) oj!: string;
  @Prop({ required: true }) problemId!: string;
  /** Remote title from the last verify, shown to editors. */
  @Prop({ default: '' }) title!: string;
  @Prop({
    type: [SchemaFactory.createForClass(ExternalLanguage)],
    default: [],
  })
  languages!: ExternalLanguage[];
  @Prop({ type: Date, default: null }) verifiedAt!: Date | null;
}

export const ExternalJudgeLinkSchema =
  SchemaFactory.createForClass(ExternalJudgeLink);
