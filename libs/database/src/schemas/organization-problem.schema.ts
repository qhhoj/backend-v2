import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;

/** One organization's own view of one of its problems: tags and the archived flag. A link exists only for organizations listed in `problem.organizations`; org admins write links, never problem documents. */
@Schema({ ...baseSchemaOptions, collection: 'organizationProblems' })
export class OrganizationProblem {
  @IdProp() _id!: string;
  @Prop({ type: UUID, required: true }) organization!: string;
  @Prop({ type: UUID, required: true }) problem!: string;
  @Prop({ type: [UUID], default: [] }) tagIds!: string[];
  @Prop({ default: false }) archived!: boolean;
  updatedAt!: Date;
}

export const OrganizationProblemSchema =
  SchemaFactory.createForClass(OrganizationProblem);
OrganizationProblemSchema.index(
  { organization: 1, problem: 1 },
  { unique: true },
);
// The list's archived filter and the tag filter.
OrganizationProblemSchema.index({ organization: 1, archived: 1 });
OrganizationProblemSchema.index({ organization: 1, tagIds: 1 });
