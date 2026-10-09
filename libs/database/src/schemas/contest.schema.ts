import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp, PLAIN_OBJECT } from '../schema';
import { uuidStr } from '../uuid';

const UUID = MongooseSchema.Types.UUID;
const Mixed = MongooseSchema.Types.Mixed;

export const CONTEST_KEY_PATTERN = /^[a-z0-9_]{1,32}$/;
export const CONTEST_TAG_PATTERN = /^[a-z0-9-]{1,20}$/;
/** Legacy format names, `Ultimate` lower-cased; `atcoder` and `ecoo` dropped (unused). */
export const CONTEST_FORMAT_NAMES = [
  'default',
  'ioi',
  'ioi16',
  'icpc',
  'vnoj',
  'ultimate',
  'final_submission',
] as const;
export type ContestFormatName = (typeof CONTEST_FORMAT_NAMES)[number];
export const LABEL_STYLES = ['numeric', 'alpha'] as const;
export type LabelStyle = (typeof LABEL_STYLES)[number];
/** Visible, Hidden, hidden during the Contest, hidden during the Participation. */
export const SCOREBOARD_VISIBILITIES = ['V', 'H', 'C', 'P'] as const;
export type ScoreboardVisibility = (typeof SCOREBOARD_VISIBILITIES)[number];
export const MAX_POINTS_PRECISION = 10;
export const MAX_CONTEST_PROBLEMS = 100;
const SHA256_HEX = /^[0-9a-f]{64}$/;

@Schema({ _id: false })
export class ContestProblem {
  @Prop({ type: UUID, required: true }) problem!: string;
  @Prop({ required: true, min: 0 }) points!: number;
  @Prop({ default: true }) partial!: boolean;
  @Prop({ default: false }) isPretested!: boolean;
  /** Position in the contest (0-based), the array order. */
  @Prop({ required: true, min: 0 }) order!: number;
  @Prop({ type: Number, default: null }) outputPrefixOverride!: number | null;
  /** Null: unlimited. */
  @Prop({ type: Number, default: null, min: 1 }) maxSubmissions!: number | null;
}
export const ContestProblemSchema =
  SchemaFactory.createForClass(ContestProblem);

// `minimize: false` keeps an empty `formatConfig` stored.
export const CONTEST_RULES_MAX = 8192;
export const AUTO_PUBLISH_STATUSES = ['published', 'failed'] as const;

/** What the automatic publish after the end did; set once, by the worker. */
@Schema({ _id: false })
export class ContestAutoPublishOutcome {
  @Prop({ type: Date, required: true }) at!: Date;
  @Prop({ type: String, required: true, enum: AUTO_PUBLISH_STATUSES })
  status!: (typeof AUTO_PUBLISH_STATUSES)[number];
  /** Empty on success; `no_permission` or `actor_unavailable` on a failure. */
  @Prop({ default: '' }) reason!: string;
  @Prop({ default: 0 }) published!: number;
  @Prop({ default: 0 }) skipped!: number;
}
export const ContestAutoPublishOutcomeSchema = SchemaFactory.createForClass(
  ContestAutoPublishOutcome,
);

@Schema({ ...baseSchemaOptions, collection: 'contests', minimize: false })
export class Contest {
  @IdProp() _id!: string;
  @Prop({ required: true, match: CONTEST_KEY_PATTERN }) key!: string;
  @Prop({ required: true, maxlength: 100 }) name!: string;
  @Prop({ default: '' }) description!: string;
  @Prop({ default: '' }) descriptionHtml!: string;
  @Prop({ default: '' }) summary!: string;
  @Prop({
    type: [String],
    default: [],
    validate: {
      validator: (tags: string[]) =>
        tags.every((tag) => CONTEST_TAG_PATTERN.test(tag)),
      message: 'tags must match ^[a-z0-9-]{1,20}$',
    },
  })
  tags!: string[];
  @Prop({ type: [UUID], default: [] }) authors!: string[];
  @Prop({ type: [UUID], default: [] }) curators!: string[];
  @Prop({ type: [UUID], default: [] }) testers!: string[];
  @Prop({ type: Date, required: true }) startTime!: Date;
  @Prop({ type: Date, required: true }) endTime!: Date;
  /** Seconds a participant gets from joining; null: the whole window. */
  @Prop({ type: Number, default: null, min: 1 }) timeLimit!: number | null;
  @Prop({ type: Date, default: null }) registrationStart!: Date | null;
  @Prop({ type: Date, default: null }) registrationEnd!: Date | null;
  @Prop({ default: 0, min: 0 }) frozenLastMinutes!: number;
  /** Live submissions are not rejudged after this (copied onto each live submission). */
  @Prop({ type: Date, default: null }) lockedAfter!: Date | null;
  @Prop({ default: false }) disallowVirtual!: boolean;
  @Prop({ default: false }) isVisible!: boolean;
  @Prop({ default: false }) isPrivate!: boolean;
  @Prop({ type: [UUID], default: [] }) privateContestants!: string[];
  @Prop({ default: false }) isOrganizationPrivate!: boolean;
  @Prop({ type: [UUID], default: [] }) organizations!: string[];
  /** sha256 hex of the access code; null: no code. */
  @Prop({ type: String, default: null, match: SHA256_HEX }) accessCodeHash!:
    string | null;
  @Prop({ type: [UUID], default: [] }) bannedUsers!: string[];
  /** Judge names (judges are never renamed; commands and dispatch use names). */
  @Prop({ type: [String], default: [] }) bannedJudges!: string[];
  /** sha256 hex; checked by the public ranking links (4b). */
  @Prop({ type: String, default: null, match: SHA256_HEX })
  rankingAccessCodeHash!: string | null;
  @Prop({ type: String, default: 'V', enum: SCOREBOARD_VISIBILITIES })
  scoreboardVisibility!: ScoreboardVisibility;
  @Prop({ type: [UUID], default: [] }) viewContestScoreboard!: string[];
  /** Seconds; 0 disables the ranking cache. */
  @Prop({ default: 0, min: 0 }) scoreboardCacheTimeout!: number;
  @Prop({ default: false }) showSubmissionList!: boolean;
  @Prop({ default: 3, min: 0, max: MAX_POINTS_PRECISION })
  pointsPrecision!: number;
  @Prop({ default: false }) runPretestsOnly!: boolean;
  @Prop({ default: false }) hideProblemTags!: boolean;
  @Prop({ default: false }) hideProblemAuthors!: boolean;
  @Prop({ default: false }) showShortDisplay!: boolean;
  @Prop({ default: false }) pushAnnouncements!: boolean;
  /** Markdown rules a participant accepts at every new participation; empty: none. */
  @Prop({ default: '', maxlength: CONTEST_RULES_MAX }) rules!: string;
  /** `rules` rendered and sanitised at save. */
  @Prop({ default: '' }) rulesHtml!: string;
  /** Bumped when the rules text changes; each acceptance stores the revision it saw. */
  @Prop({ default: 0, min: 0 }) rulesRevision!: number;
  /** Publish the problems and editorials when the contest ends. */
  @Prop({ default: false }) publishAfterEnd!: boolean;
  /** The editor who switched `publishAfterEnd` on: their rights are re-checked when the job runs. */
  @Prop({ type: UUID, default: null }) publishAfterEndBy!: string | null;
  @Prop({ type: ContestAutoPublishOutcomeSchema, default: null })
  autoPublishOutcome!: ContestAutoPublishOutcome | null;
  @Prop({ type: String, default: 'numeric', enum: LABEL_STYLES })
  labelStyle!: LabelStyle;
  @Prop({ default: false }) isRated!: boolean;
  @Prop({ default: false }) rateAll!: boolean;
  @Prop({ type: [UUID], default: [] }) rateExclude!: string[];
  @Prop({ type: Number, default: null }) ratingFloor!: number | null;
  @Prop({ type: Number, default: null }) ratingCeiling!: number | null;
  @Prop({ type: String, default: 'default', enum: CONTEST_FORMAT_NAMES })
  formatName!: ContestFormatName;
  /** Validated by the format's `parseConfig` (`@libs/contests`) before every write. */
  @Prop({ type: Mixed, default: () => ({}), validate: PLAIN_OBJECT })
  formatConfig!: Record<string, unknown>;
  /** Live participations (registrations included); recomputed, never incremented. */
  @Prop({ default: 0 }) userCount!: number;
  @Prop({ default: 0 }) virtualCount!: number;
  /** Legacy `data_last_downloaded`: when an editor last asked for the data zip. */
  @Prop({ type: Date, default: null }) dataPreparedAt!: Date | null;
  /** The integration client that created the contest through the sync API; only that client may change it. Null: made by a person. */
  @Prop({ type: UUID, default: null }) managedBy!: string | null;
  @Prop({
    type: [ContestProblemSchema],
    default: [],
    validate: [
      {
        validator: (problems: ContestProblem[]) =>
          problems.length <= MAX_CONTEST_PROBLEMS,
        message: `at most ${MAX_CONTEST_PROBLEMS} problems`,
      },
      {
        // Elements may be BSON UUIDs or strings depending on the write path; `uuidStr` normalises both.
        validator: (problems: ContestProblem[]) =>
          new Set(problems.map(({ problem }) => uuidStr(problem))).size ===
          problems.length,
        message: 'a problem may appear once',
      },
    ],
  })
  problems!: ContestProblem[];
}

export const ContestSchema = SchemaFactory.createForClass(Contest);
ContestSchema.index({ key: 1 }, { unique: true });
// The public contest count of the homepage.
ContestSchema.index({ isVisible: 1, isPrivate: 1, isOrganizationPrivate: 1 });
ContestSchema.index({ startTime: -1 });
ContestSchema.index({ endTime: -1 });
ContestSchema.index({ authors: 1 });
ContestSchema.index({ curators: 1 });
ContestSchema.index({ testers: 1 });
ContestSchema.index({ organizations: 1 });
ContestSchema.index({ managedBy: 1 }, { sparse: true });
// A problem rescore finds the contests that list the problem.
ContestSchema.index({ 'problems.problem': 1 });
