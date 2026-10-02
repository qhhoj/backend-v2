import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MSchema } from 'mongoose';
import { baseSchemaOptions, ciIndex, IdProp } from '../schema';

const UUID = MSchema.Types.UUID;

@Schema({ id: false })
export class WebauthnCredential {
  @IdProp() _id!: string;
  @Prop({ required: true }) name!: string;
  @Prop({ required: true }) credId!: string;
  @Prop({ required: true }) publicKey!: string;
  @Prop({ required: true }) counter!: number;
}

@Schema({ _id: false })
export class SocialAuth {
  @Prop({ required: true }) provider!: string;
  @Prop({ required: true }) uid!: string;
  @Prop({ type: Object, default: {} }) extraData!: Record<string, unknown>;
}

@Schema({ ...baseSchemaOptions, collection: 'users' })
export class User {
  @IdProp() _id!: string;
  @Prop({ required: true }) username!: string;
  @Prop({ default: '' }) email!: string;
  @Prop({ required: true }) password!: string;
  @Prop({ default: '' }) firstName!: string;
  @Prop({ default: '' }) lastName!: string;
  @Prop({ default: false }) isStaff!: boolean;
  @Prop({ default: false }) isActive!: boolean;
  @Prop({ default: false }) isSuperuser!: boolean;
  @Prop({ type: Date, default: null }) lastLogin!: Date | null;
  @Prop({ type: Date, default: () => new Date() }) dateJoined!: Date;
  @Prop({ type: [UUID], default: [] }) groups!: string[];
  @Prop({ type: [String], default: [] }) permissions!: string[];
  @Prop({ type: String, default: null }) about!: string | null;
  @Prop({ default: 'America/Toronto' }) timezone!: string;
  @Prop({ type: UUID, default: null }) languageId!: string | null;
  @Prop({ default: 0 }) points!: number;
  @Prop({ default: 0 }) performancePoints!: number;
  @Prop({ default: 0 }) contributionPoints!: number;
  @Prop({ default: 0 }) vnojPoints!: number;
  @Prop({ default: 0 }) problemCount!: number;
  @Prop({ default: 'auto' }) aceTheme!: string;
  @Prop({ default: 'light' }) siteTheme!: string;
  @Prop({ type: Date, default: null }) lastAccess!: Date | null;
  @Prop({ type: String, default: null }) ip!: string | null;
  @Prop({ type: [UUID], default: [] }) badges!: string[];
  @Prop({ type: UUID, default: null }) displayBadgeId!: string | null;
  @Prop({ type: [UUID], default: [] }) organizations!: string[];
  @Prop({ default: 'user' }) displayRank!: string;
  @Prop({ default: false }) mute!: boolean;
  @Prop({ default: false }) isUnlisted!: boolean;
  @Prop({ type: String, default: null }) banReason!: string | null;
  @Prop({ default: true }) allowTagging!: boolean;
  @Prop({ type: Number, default: null }) rating!: number | null;
  @Prop({ default: '' }) userScript!: string;
  @Prop({ type: UUID, default: null }) currentContestId!: string | null;
  @Prop({ default: 'auto' }) mathEngine!: string;
  @Prop({ default: false }) isTotpEnabled!: boolean;
  @Prop({ default: false }) isWebauthnEnabled!: boolean;
  @Prop({ type: String, default: null }) totpKey!: string | null;
  @Prop({ type: String, default: null }) scratchCodes!: string | null;
  @Prop({ default: 0 }) lastTotpTimecode!: number;
  @Prop({ type: String, default: null }) notes!: string | null;
  @Prop({ type: Date, default: null }) dataLastDownloaded!: Date | null;
  @Prop({ default: '' }) usernameDisplayOverride!: string;
  @Prop({ type: Buffer, default: null }) webauthnUserHandle!: Buffer | null;
  @Prop({
    type: [SchemaFactory.createForClass(WebauthnCredential)],
    default: [],
  })
  webauthnCredentials!: WebauthnCredential[];
  @Prop({ type: [SchemaFactory.createForClass(SocialAuth)], default: [] })
  socialAuth!: SocialAuth[];
  @Prop({ type: String, default: null }) apiTokenHash!: string | null;
}

export const UserSchema = SchemaFactory.createForClass(User);
ciIndex(UserSchema, 'username');
ciIndex(UserSchema, 'email', false);
UserSchema.index(
  { 'socialAuth.provider': 1, 'socialAuth.uid': 1 },
  {
    unique: true,
    partialFilterExpression: { 'socialAuth.uid': { $exists: true } },
  },
);
UserSchema.index(
  { 'webauthnCredentials.credId': 1 },
  {
    unique: true,
    partialFilterExpression: {
      'webauthnCredentials.credId': { $exists: true },
    },
  },
);
