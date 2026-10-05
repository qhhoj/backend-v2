import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';
import { ProblemData, ProblemDataSchema } from './problem-data.schema';

const UUID = MongooseSchema.Types.UUID;

export const PROBLEM_CODE_PATTERN = /^[a-z0-9_]{1,32}$/;
export const STATEMENT_LANGUAGES = ['en', 'vi'] as const;
export type StatementLanguage = (typeof STATEMENT_LANGUAGES)[number];
export const SUBMISSION_SOURCE_VISIBILITIES = ['F', 'A', 'S', 'O'] as const;
export const TESTCASE_VISIBILITIES = ['O', 'C', 'A'] as const;
export const TESTCASE_RESULT_VISIBILITIES = ['A', 'B', 'S'] as const;
export const PROBLEM_LIMITS = {
  timeLimit: { min: 0.01, max: 60 },
  memoryLimit: { min: 0, max: 1048576 },
  points: { min: 800, max: 3500 },
} as const;

@Schema({ _id: false })
export class LanguageLimit {
  @Prop({ type: UUID, required: true }) languageId!: string;
  @Prop({ required: true }) timeLimit!: number;
  @Prop({ required: true }) memoryLimit!: number;
}

@Schema({ _id: false })
export class ProblemTranslation {
  @Prop({ type: String, required: true, enum: STATEMENT_LANGUAGES })
  language!: StatementLanguage;
  @Prop({ required: true, maxlength: 100 }) name!: string;
  @Prop({ default: '' }) description!: string;
  @Prop({ default: '' }) descriptionHtml!: string;
}

@Schema({ _id: false })
export class ProblemSolution {
  @Prop({ default: false }) isPublic!: boolean;
  @Prop({ type: Date, required: true }) publishOn!: Date;
  @Prop({ type: [UUID], default: [] }) authors!: string[];
  @Prop({ default: '' }) content!: string;
  @Prop({ default: '' }) contentHtml!: string;
}

@Schema({ ...baseSchemaOptions, collection: 'problems' })
export class Problem {
  @IdProp() _id!: string;
  @Prop({ required: true, match: PROBLEM_CODE_PATTERN }) code!: string;
  @Prop({ required: true, maxlength: 100 }) name!: string;
  @Prop({ default: '', maxlength: 200 }) source!: string;
  @Prop({ default: '' }) summary!: string;
  @Prop({ default: '' }) description!: string;
  @Prop({ default: '' }) descriptionHtml!: string;
  @Prop({
    required: true,
    min: PROBLEM_LIMITS.timeLimit.min,
    max: PROBLEM_LIMITS.timeLimit.max,
  })
  timeLimit!: number;
  @Prop({
    required: true,
    min: PROBLEM_LIMITS.memoryLimit.min,
    max: PROBLEM_LIMITS.memoryLimit.max,
  })
  memoryLimit!: number;
  @Prop({
    required: true,
    min: PROBLEM_LIMITS.points.min,
    max: PROBLEM_LIMITS.points.max,
  })
  points!: number;
  @Prop({ default: false }) partial!: boolean;
  @Prop({ default: false }) isPublic!: boolean;
  @Prop({ type: Date, default: null }) date!: Date | null;
  @Prop({ default: false }) isOrganizationPrivate!: boolean;
  @Prop({ type: [UUID], default: [] }) organizations!: string[];
  @Prop({ default: false }) isManuallyManaged!: boolean;
  @Prop({ default: false }) isFullMarkup!: boolean;
  @Prop({ type: [UUID], required: true }) typeIds!: string[];
  @Prop({ type: UUID, required: true }) groupId!: string;
  @Prop({ type: UUID, default: null }) licenseId!: string | null;
  @Prop({ type: [UUID], default: [] }) authors!: string[];
  @Prop({ type: [UUID], default: [] }) curators!: string[];
  @Prop({ type: [UUID], default: [] }) testers!: string[];
  @Prop({ type: [UUID], default: [] }) bannedUsers!: string[];
  @Prop({ type: UUID, default: null }) suggester!: string | null;
  @Prop({ type: [UUID], default: [] }) allowedLanguages!: string[];
  @Prop({ type: [SchemaFactory.createForClass(LanguageLimit)], default: [] })
  languageLimits!: LanguageLimit[];
  @Prop({
    type: [SchemaFactory.createForClass(ProblemTranslation)],
    default: [],
  })
  translations!: ProblemTranslation[];
  @Prop({ type: SchemaFactory.createForClass(ProblemSolution), default: null })
  solution!: ProblemSolution | null;
  @Prop({ type: String, default: null }) pdfStatementUrl!: string | null;
  @Prop({ type: String, default: null }) materialUrl!: string | null;
  @Prop({ default: '' }) ogImage!: string;
  @Prop({ type: String, default: 'F', enum: SUBMISSION_SOURCE_VISIBILITIES })
  submissionSourceVisibility!: string;
  @Prop({ type: String, default: 'O', enum: TESTCASE_VISIBILITIES })
  testcaseVisibility!: string;
  @Prop({ type: String, default: 'A', enum: TESTCASE_RESULT_VISIBILITIES })
  testcaseResultVisibility!: string;
  @Prop({ default: false }) allowViewFeedback!: boolean;
  /** Stored for the migrator; editing and `mirrorRoot` computation belong to sub-project 6. */
  @Prop({ type: UUID, default: null }) mirrorOf!: string | null;
  @Prop({ type: UUID, default: null }) mirrorRoot!: string | null;
  /** Written by sub-project 2. */
  @Prop({ default: 0 }) userCount!: number;
  @Prop({ default: 0 }) acRate!: number;
  /** Test data configuration (3b); null until the data editor or an import writes it. */
  @Prop({ type: ProblemDataSchema, default: null, select: false })
  data!: ProblemData | null;
  /** Compare-and-set counter for `data`: bumped by every data write so concurrent editors cannot overwrite each other. */
  @Prop({ default: 0 }) dataVersion!: number;
}

export const ProblemSchema = SchemaFactory.createForClass(Problem);
ProblemSchema.index({ code: 1 }, { unique: true });
ProblemSchema.index({ isPublic: 1, date: -1 });
ProblemSchema.index({ organizations: 1 });
ProblemSchema.index({ authors: 1 });
ProblemSchema.index({ curators: 1 });
ProblemSchema.index({ testers: 1 });
ProblemSchema.index({ suggester: 1 });
// `translations[].language` holds en|vi; a text index reads a field named `language` as the per-document
// text language and rejects `vi`, so the override points at an unused field. No stemming: statements are Vietnamese.
ProblemSchema.index(
  { code: 'text', name: 'text', 'translations.name': 'text', source: 'text' },
  {
    name: 'problem_text',
    weights: { code: 10, name: 5 },
    default_language: 'none',
    language_override: 'textLanguage',
  },
);
