import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;

@Schema({ _id: false })
export class SimilaritySide {
  @Prop({ type: UUID, required: true }) submission!: string;
  @Prop({ type: UUID, required: true }) user!: string;
}
export const SimilaritySideSchema =
  SchemaFactory.createForClass(SimilaritySide);

/** 1-based inclusive line ranges, one per side; sources are read from `submissionSources` on view. */
@Schema({ _id: false })
export class SimilarityFragment {
  @Prop({ required: true, min: 1 }) leftStart!: number;
  @Prop({ required: true, min: 1 }) leftEnd!: number;
  @Prop({ required: true, min: 1 }) rightStart!: number;
  @Prop({ required: true, min: 1 }) rightEnd!: number;
}
export const SimilarityFragmentSchema =
  SchemaFactory.createForClass(SimilarityFragment);

@Schema({ ...baseSchemaOptions, collection: 'similarityPairs' })
export class SimilarityPair {
  @IdProp() _id!: string;
  @Prop({ type: UUID, required: true }) run!: string;
  @Prop({ type: UUID, required: true }) problem!: string;
  /** Engine family name, as on `SimilarityGroup.language`. */
  @Prop({ required: true }) language!: string;
  /** The older submission (lower id); `left.user` is never `right.user`. */
  @Prop({ type: SimilaritySideSchema, required: true }) left!: SimilaritySide;
  @Prop({ type: SimilaritySideSchema, required: true }) right!: SimilaritySide;
  /** Covered fraction of both files, 0 to 1. */
  @Prop({ required: true, min: 0, max: 1 }) similarity!: number;
  /** Longest shared fragment, in k-grams. */
  @Prop({ required: true, min: 0 }) longestFragment!: number;
  /** Shared k-grams over both files. */
  @Prop({ required: true, min: 0 }) totalOverlap!: number;
  @Prop({ type: [SimilarityFragmentSchema], default: [] })
  fragments!: SimilarityFragment[];
}

export const SimilarityPairSchema =
  SchemaFactory.createForClass(SimilarityPair);
// The viewer's table: a run's pairs best first, optionally for one problem and family.
SimilarityPairSchema.index({ run: 1, similarity: -1, _id: 1 });
SimilarityPairSchema.index({
  run: 1,
  problem: 1,
  language: 1,
  similarity: -1,
  _id: 1,
});
