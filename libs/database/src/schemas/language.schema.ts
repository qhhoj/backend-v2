import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { baseSchemaOptions, ciIndex, IdProp } from '../schema';

/** A file-only upload is stored and served under this extension, so it may not carry a path or an unexpected media type. */
export const LANGUAGE_EXTENSION_PATTERN = /^[a-z0-9]{1,10}$/;

@Schema({ ...baseSchemaOptions, collection: 'languages' })
export class Language {
  @IdProp() _id!: string;
  @Prop({ required: true, maxlength: 10 }) key!: string;
  @Prop({ required: true, maxlength: 20 }) name!: string;
  @Prop({ type: String, default: null }) shortName!: string | null;
  @Prop({ required: true, maxlength: 20 }) commonName!: string;
  @Prop({ required: true }) ace!: string;
  @Prop({ required: true }) pygments!: string;
  @Prop({ default: '' }) template!: string;
  @Prop({ default: '' }) info!: string;
  @Prop({ default: '' }) description!: string;
  @Prop({ required: true, match: LANGUAGE_EXTENSION_PATTERN })
  extension!: string;
  @Prop({ default: false }) fileOnly!: boolean;
  @Prop({ default: 0 }) fileSizeLimit!: number;
  @Prop({ default: false }) includeInProblem!: boolean;
  /** false hides it from the submit form and refuses new submissions in it; past submissions still show it. Rows from before the field read as active (`isLanguageActive`). */
  @Prop({ default: true }) isActive!: boolean;
  /** Lists show languages by `order`, then name; lower first. */
  @Prop({ default: 0 }) order!: number;
}

export const LanguageSchema = SchemaFactory.createForClass(Language);
ciIndex(LanguageSchema, 'key');

/** A row stored before `isActive` existed has no field: it is active. */
export const isLanguageActive = (language: Pick<Language, 'isActive'>) =>
  language.isActive !== false;

/** `order` (missing on old rows: 0), then name. */
export const compareLanguages = (
  first: Pick<Language, 'order' | 'name'>,
  second: Pick<Language, 'order' | 'name'>,
): number =>
  (first.order ?? 0) - (second.order ?? 0) ||
  first.name.localeCompare(second.name, 'en', { sensitivity: 'base' });
