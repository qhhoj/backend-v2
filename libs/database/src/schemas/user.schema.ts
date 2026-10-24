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

/** Roaming Bits until the user chooses: off, one Bit. Also what accounts saved before the field read as. */
export const DEFAULT_BIT_ROAM = { on: false, count: 1 } as const;

@Schema({ ...baseSchemaOptions, collection: 'users' })
export class User {
  @IdProp() _id!: string;
  @Prop({ required: true }) username!: string;
  /** Names the account had before a staff rename; old profile links still find it while no account holds the name. */
  @Prop({ type: [String], default: [] }) previousUsernames!: string[];
  /** When staff last renamed the account: of several accounts that once had a name, the most recently renamed answers to it. */
  @Prop({ type: Date, default: null }) renamedAt!: Date | null;
  @Prop({ default: '' }) email!: string;
  @Prop({ required: true }) password!: string;
  @Prop({ default: '' }) firstName!: string;
  @Prop({ default: '' }) lastName!: string;
  @Prop({ default: false }) isStaff!: boolean;
  @Prop({ default: false }) isActive!: boolean;
  /** Set while staff keep the account deactivated, so it is never mistaken for an abandoned signup and reclaimed. */
  @Prop({ type: Date, default: null }) deactivatedAt!: Date | null;
  @Prop({ default: false }) isSuperuser!: boolean;
  @Prop({ type: Date, default: null }) lastLogin!: Date | null;
  @Prop({ type: Date, default: () => new Date() }) dateJoined!: Date;
  @Prop({ type: [UUID], default: [] }) groups!: string[];
  @Prop({ type: [String], default: [] }) permissions!: string[];
  @Prop({ type: String, default: null }) about!: string | null;
  /** `about` rendered at save in the `user` style. */
  @Prop({ default: '' }) aboutHtml!: string;
  @Prop({ default: 'Asia/Ho_Chi_Minh' }) timezone!: string;
  @Prop({ type: UUID, default: null }) languageId!: string | null;
  @Prop({ default: 0 }) points!: number;
  @Prop({ default: 0 }) performancePoints!: number;
  @Prop({ default: 0 }) contributionPoints!: number;
  @Prop({ default: 0 }) problemCount!: number;
  @Prop({ default: 'auto' }) aceTheme!: string;
  @Prop({ default: 'auto' }) siteTheme!: string;
  /** The user's own look (accent preset, glass 0-100, glow 0-100); null = the site's look. Validated by `AppearanceDto`. */
  @Prop({ type: Object, default: null })
  appearance!: { accent: string; glass: number; glow: number } | null;
  /** Roaming Bits on every page (frontend `features/bit-roam`): switch and count 1-5. Validated by `BitRoamDto`. */
  @Prop({ type: Object, default: () => ({ ...DEFAULT_BIT_ROAM }) })
  bitRoam!: { on: boolean; count: number };
  @Prop({ type: Date, default: null }) lastAccess!: Date | null;
  @Prop({ type: String, default: null }) ip!: string | null;
  @Prop({ type: [UUID], default: [] }) organizations!: string[];
  @Prop({ default: 'user' }) displayRank!: string;
  @Prop({ default: false }) mute!: boolean;
  @Prop({ default: false }) isUnlisted!: boolean;
  @Prop({ type: String, default: null }) banReason!: string | null;
  /** `isActive` when a moderator banned the account, so unbanning restores it; null outside a ban or for bans older than the field (unbanning activates those, as legacy did). */
  @Prop({ type: Boolean, default: null }) isActiveBeforeBan!: boolean | null;
  @Prop({ default: true }) allowTagging!: boolean;
  @Prop({ type: Number, default: null }) rating!: number | null;
  @Prop({ default: '' }) userScript!: string;
  /** The participation the user is in (legacy `current_contest`); cleared lazily once it ended or its contest became invisible. */
  @Prop({ type: UUID, default: null }) currentParticipation!: string | null;
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
ciIndex(UserSchema, 'previousUsernames', false);
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
// Problem stats leave unlisted users out; there are few of them.
UserSchema.index(
  { isUnlisted: 1 },
  { partialFilterExpression: { isUnlisted: true } },
);
// Leaderboards and ranks: listed, active users by one field, ties by id (legacy `order_by(order, 'id')`).
export const LEADERBOARD_FIELDS = [
  'performancePoints',
  'points',
  'problemCount',
  'rating',
  'contributionPoints',
] as const;
export type LeaderboardField = (typeof LEADERBOARD_FIELDS)[number];
for (const field of LEADERBOARD_FIELDS)
  UserSchema.index({ isUnlisted: 1, isActive: 1, [field]: -1, _id: 1 });
// Staff list sorted by last access, either way (the id breaks ties in the same direction).
UserSchema.index({ lastAccess: 1, _id: 1 });
// Staff list of banned users; the ban reason is only set while banned.
UserSchema.index(
  { banReason: 1 },
  { partialFilterExpression: { banReason: { $type: 'string' } } },
);
// Organization points (top 100 by PP), member counts and member lists.
UserSchema.index({ organizations: 1, performancePoints: -1 });
// Who holds a permission, directly or through a group (ticket alerts to staff).
UserSchema.index({ permissions: 1 });
UserSchema.index({ groups: 1 });
