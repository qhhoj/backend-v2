import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;

/** Colour token keys, defined in every theme file by the frontend; never a hex. */
export const ORGANIZATION_TAG_COLORS = [
  'tag-1',
  'tag-2',
  'tag-3',
  'tag-4',
  'tag-5',
  'tag-6',
  'tag-7',
  'tag-8',
] as const;
export type OrganizationTagColor = (typeof ORGANIZATION_TAG_COLORS)[number];
export const ORGANIZATION_TAG_SLUG_PATTERN = /^[a-z0-9-]{1,20}$/;
export const MAX_ORGANIZATION_TAGS = 100;

/** A label an organization's admins give to the organization's problems. */
@Schema({ ...baseSchemaOptions, collection: 'organizationProblemTags' })
export class OrganizationProblemTag {
  @IdProp() _id!: string;
  @Prop({ type: UUID, required: true }) organization!: string;
  @Prop({ required: true, match: ORGANIZATION_TAG_SLUG_PATTERN }) slug!: string;
  @Prop({ required: true, minlength: 1, maxlength: 40 }) name!: string;
  @Prop({ type: String, default: 'tag-1', enum: ORGANIZATION_TAG_COLORS })
  color!: OrganizationTagColor;
  createdAt!: Date;
}

export const OrganizationProblemTagSchema = SchemaFactory.createForClass(
  OrganizationProblemTag,
);
OrganizationProblemTagSchema.index(
  { organization: 1, slug: 1 },
  { unique: true },
);
