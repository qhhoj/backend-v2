import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;

export const RANKING_LINK_TOKEN_PATTERN = /^[A-Za-z0-9]{18}$/;
export const RANKING_LINK_STATUSES = ['public', 'private'] as const;
export const RANKING_LINK_EXPIRY_MODES = ['U', 'M', 'D', 'A'] as const;

/** Tokens stay plain (editors read the link back, as in legacy); 107 bits plus the per-IP miss limit make guessing pointless. */
@Schema({ ...baseSchemaOptions, collection: 'contestPublicRankingLinks' })
export class ContestPublicRankingLink {
  @IdProp() _id!: string;
  @Prop({ type: UUID, required: true }) contest!: string;
  @Prop({ required: true, match: RANKING_LINK_TOKEN_PATTERN }) token!: string;
  @Prop({ type: String, enum: RANKING_LINK_STATUSES, default: 'public' })
  status!: (typeof RANKING_LINK_STATUSES)[number];
  @Prop({ type: String, enum: RANKING_LINK_EXPIRY_MODES, default: 'U' })
  expiryMode!: (typeof RANKING_LINK_EXPIRY_MODES)[number];
  @Prop({ type: Number, default: null, min: 1 }) expiryAmount!: number | null;
  @Prop({ type: Date, default: null }) expiresAt!: Date | null;
  @Prop({ type: Date, required: true }) regeneratedAt!: Date;
}

export const ContestPublicRankingLinkSchema = SchemaFactory.createForClass(
  ContestPublicRankingLink,
);
ContestPublicRankingLinkSchema.index({ contest: 1 }, { unique: true });
ContestPublicRankingLinkSchema.index({ token: 1 }, { unique: true });
