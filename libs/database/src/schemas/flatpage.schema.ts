import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

/** Canonical flatpage url length (`/about`, `/help/faq`). */
export const FLATPAGE_URL_MAX_LENGTH = 200;
export const FLATPAGE_TITLE_MAX_LENGTH = 200;
/** Not a schema bound; the staff API refuses longer Markdown. */
export const FLATPAGE_CONTENT_MAX_LENGTH = 100_000;

/** Legacy `django.contrib.flatpages`. `url` is canonical (`/about`, no trailing slash); `contentHtml` is rendered by whoever writes the page. */
@Schema({ ...baseSchemaOptions, collection: 'flatpages' })
export class Flatpage {
  @IdProp() _id!: string;
  @Prop({ required: true, maxlength: FLATPAGE_URL_MAX_LENGTH }) url!: string;
  @Prop({ required: true, maxlength: FLATPAGE_TITLE_MAX_LENGTH })
  title!: string;
  @Prop({ default: '' }) content!: string;
  @Prop({ default: '' }) contentHtml!: string;
  @Prop({ default: false }) registrationRequired!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}
export const FlatpageSchema = SchemaFactory.createForClass(Flatpage);
FlatpageSchema.index({ url: 1 }, { unique: true });
