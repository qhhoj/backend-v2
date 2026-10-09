import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';
import { TAG_COLORS } from './tag-color';
import type { TagColor } from './tag-color';

const UUID = MongooseSchema.Types.UUID;

export const ORGANIZATION_TAG_SLUG_PATTERN = /^[a-z0-9-]{1,20}$/;
export const MAX_ORGANIZATION_TAGS = 100;

/** A label an organization's admins give to the organization's problems. */
@Schema({ ...baseSchemaOptions, collection: 'organizationProblemTags' })
export class OrganizationProblemTag {
  @IdProp() _id!: string;
  @Prop({ type: UUID, required: true }) organization!: string;
  @Prop({ required: true, match: ORGANIZATION_TAG_SLUG_PATTERN }) slug!: string;
  @Prop({ required: true, minlength: 1, maxlength: 40 }) name!: string;
  @Prop({ type: String, default: 'tag-1', enum: TAG_COLORS })
  color!: TagColor;
  createdAt!: Date;
}

export const OrganizationProblemTagSchema = SchemaFactory.createForClass(
  OrganizationProblemTag,
);
OrganizationProblemTagSchema.index(
  { organization: 1, slug: 1 },
  { unique: true },
);
