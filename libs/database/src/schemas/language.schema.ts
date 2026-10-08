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
}
export const LanguageSchema = SchemaFactory.createForClass(Language);
ciIndex(LanguageSchema, 'key');
