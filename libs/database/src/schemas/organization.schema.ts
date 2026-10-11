import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, ciIndex, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;

/** Legacy slug validator: starts with a letter; Django `SlugField` characters. */
export const ORGANIZATION_SLUG_PATTERN = /^[A-Za-z][-A-Za-z0-9_]*$/;

/** Legacy `Organization` without `access_code` (unused). Members are `users.organizations` (ordered; the first is the user's displayed organization); admins are always members. */
@Schema({ ...baseSchemaOptions, collection: 'organizations' })
export class Organization {
  @IdProp() _id!: string;
  @Prop({ required: true, minlength: 1, maxlength: 128 }) name!: string;
  @Prop({ required: true, maxlength: 128, match: ORGANIZATION_SLUG_PATTERN })
  slug!: string;
  @Prop({ required: true, minlength: 1, maxlength: 20 }) shortName!: string;
  @Prop({ default: '' }) about!: string;
  /** `about` rendered at save in the `user` style. */
  @Prop({ default: '' }) aboutHtml!: string;
  @Prop({ type: [UUID], default: [] }) adminIds!: string[];
  /** Open: anyone joins directly; private (false): join requests. */
  @Prop({ default: false }) isOpen!: boolean;
  /** Legacy default: a new organization stays unlisted until staff lists it. */
  @Prop({ default: true }) isUnlisted!: boolean;
  /** Most members a private organization takes through approvals; null: unlimited. */
  @Prop({ type: Number, default: null, min: 0 }) slots!: number | null;
  @Prop({ default: '', maxlength: 150 }) logoOverrideImage!: string;
  /** Written only by the `organization-points` job. */
  @Prop({ default: 0 }) performancePoints!: number;
  /** Written only by the `organization-points` job. */
  @Prop({ default: 0, min: 0 }) memberCount!: number;
  /** Staff-set caps; null falls back to the `quota.default*` settings. */
  @Prop({ type: Number, default: null, min: 0 }) quotaStorageBytes!:
    number | null;
  @Prop({ type: Number, default: null, min: 0 }) quotaMonthlyCredits!:
    number | null;
  /** Promotion: the limits are reported but never applied (usage is still metered). Set for every organization imported from the old site. */
  @Prop({ type: Boolean, default: false }) quotaUnlimited!: boolean;
  /** Soft delete by a superuser: the record stays (slug still reserved) but every read skips it. Absent while live, so `{deletedAt: null}` reads "live". */
  @Prop({ type: Date }) deletedAt?: Date;
  @Prop({ type: UUID }) deletedBy?: string;
  createdAt!: Date;
}

export const OrganizationSchema = SchemaFactory.createForClass(Organization);
ciIndex(OrganizationSchema, 'slug');
// The admin-role cap counts these.
OrganizationSchema.index({ adminIds: 1 });
// The list: listed ones by name.
OrganizationSchema.index({ isUnlisted: 1, name: 1 });
