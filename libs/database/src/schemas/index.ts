import { ModelDefinition } from '@nestjs/mongoose';
import { ActivationKey, ActivationKeySchema } from './activation-key.schema';
import { Contest, ContestSchema } from './contest.schema';
import {
  ContestParticipation,
  ContestParticipationSchema,
} from './contest-participation.schema';
import {
  ContestSubmission,
  ContestSubmissionSchema,
} from './contest-submission.schema';
import {
  ContestAnnouncement,
  ContestAnnouncementSchema,
} from './contest-announcement.schema';
import { ContestMoss, ContestMossSchema } from './contest-moss.schema';
import {
  ContestOfficialRanking,
  ContestOfficialRankingSchema,
} from './contest-official-ranking.schema';
import {
  ContestPublicRankingLink,
  ContestPublicRankingLinkSchema,
} from './contest-public-ranking-link.schema';
import {
  OrganizationRequest,
  OrganizationRequestSchema,
} from './organization-request.schema';
import { Organization, OrganizationSchema } from './organization.schema';
import { Rating, RatingSchema } from './rating.schema';
import { Group, GroupSchema } from './group.schema';
import { Judge, JudgeSchema } from './judge.schema';
import { Language, LanguageSchema } from './language.schema';
import { License, LicenseSchema } from './license.schema';
import { ProblemGroup, ProblemGroupSchema } from './problem-group.schema';
import { Problem, ProblemSchema } from './problem.schema';
import { ProblemType, ProblemTypeSchema } from './problem-type.schema';
import { Revision, RevisionSchema } from './revision.schema';
import {
  SubmissionSource,
  SubmissionSourceSchema,
} from './submission-source.schema';
import { Submission, SubmissionSchema } from './submission.schema';
import { TagGroup, TagGroupSchema } from './tag-group.schema';
import { TagProblem, TagProblemSchema } from './tag-problem.schema';
import { Tag, TagSchema } from './tag.schema';
import { User, UserSchema } from './user.schema';

export * from './activation-key.schema';
export * from './contest-announcement.schema';
export * from './contest-moss.schema';
export * from './contest-official-ranking.schema';
export * from './contest-participation.schema';
export * from './contest-public-ranking-link.schema';
export * from './contest-submission.schema';
export * from './contest.schema';
export * from './group.schema';
export * from './judge.schema';
export * from './language.schema';
export * from './license.schema';
export * from './organization-request.schema';
export * from './organization.schema';
export * from './problem-data.schema';
export * from './problem-group.schema';
export * from './problem-type.schema';
export * from './problem.schema';
export * from './rating.schema';
export * from './revision.schema';
export * from './submission-source.schema';
export * from './submission.schema';
export * from './tag-group.schema';
export * from './tag-problem.schema';
export * from './tag.schema';
export * from './user.schema';
export const SCHEMAS: ModelDefinition[] = [
  { name: ActivationKey.name, schema: ActivationKeySchema },
  { name: ContestAnnouncement.name, schema: ContestAnnouncementSchema },
  { name: ContestMoss.name, schema: ContestMossSchema },
  { name: ContestOfficialRanking.name, schema: ContestOfficialRankingSchema },
  {
    name: ContestPublicRankingLink.name,
    schema: ContestPublicRankingLinkSchema,
  },
  { name: Contest.name, schema: ContestSchema },
  { name: ContestParticipation.name, schema: ContestParticipationSchema },
  { name: ContestSubmission.name, schema: ContestSubmissionSchema },
  { name: Group.name, schema: GroupSchema },
  { name: Judge.name, schema: JudgeSchema },
  { name: Language.name, schema: LanguageSchema },
  { name: License.name, schema: LicenseSchema },
  { name: OrganizationRequest.name, schema: OrganizationRequestSchema },
  { name: Organization.name, schema: OrganizationSchema },
  { name: ProblemGroup.name, schema: ProblemGroupSchema },
  { name: Problem.name, schema: ProblemSchema },
  { name: ProblemType.name, schema: ProblemTypeSchema },
  { name: Rating.name, schema: RatingSchema },
  { name: Revision.name, schema: RevisionSchema },
  { name: SubmissionSource.name, schema: SubmissionSourceSchema },
  { name: Submission.name, schema: SubmissionSchema },
  { name: TagGroup.name, schema: TagGroupSchema },
  { name: TagProblem.name, schema: TagProblemSchema },
  { name: Tag.name, schema: TagSchema },
  { name: User.name, schema: UserSchema },
];
