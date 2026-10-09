import { ModelDefinition } from '@nestjs/mongoose';
import { ActivationKey, ActivationKeySchema } from './activation-key.schema';
import { BlogPost, BlogPostSchema } from './blog-post.schema';
import { BlogVote, BlogVoteSchema } from './blog-vote.schema';
import { CommentLock, CommentLockSchema } from './comment-lock.schema';
import { CommentVote, CommentVoteSchema } from './comment-vote.schema';
import { Comment, CommentSchema } from './comment.schema';
import { Contest, ContestSchema } from './contest.schema';
import { ContestTag, ContestTagSchema } from './contest-tag.schema';
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
import { Flatpage, FlatpageSchema } from './flatpage.schema';
import { GeneralIssue, GeneralIssueSchema } from './general-issue.schema';
import { MiscConfig, MiscConfigSchema } from './misc-config.schema';
import { NavigationItem, NavigationItemSchema } from './navigation-item.schema';
import { Notification, NotificationSchema } from './notification.schema';
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
  SettingRevision,
  SettingRevisionSchema,
} from './setting-revision.schema';
import { Setting, SettingSchema } from './setting.schema';
import { SimilarityPair, SimilarityPairSchema } from './similarity-pair.schema';
import { SimilarityRun, SimilarityRunSchema } from './similarity-run.schema';
import {
  SubmissionSource,
  SubmissionSourceSchema,
} from './submission-source.schema';
import { Submission, SubmissionSchema } from './submission.schema';
import { TagGroup, TagGroupSchema } from './tag-group.schema';
import { TagProblem, TagProblemSchema } from './tag-problem.schema';
import { Tag, TagSchema } from './tag.schema';
import { Ticket, TicketSchema } from './ticket.schema';
import { UserActivity, UserActivitySchema } from './user-activity.schema';
import { UserSession, UserSessionSchema } from './user-session.schema';
import { User, UserSchema } from './user.schema';

export * from './activation-key.schema';
export * from './blog-post.schema';
export * from './blog-vote.schema';
export * from './comment-lock.schema';
export * from './comment-vote.schema';
export * from './comment.schema';
export * from './contest-announcement.schema';
export * from './contest-official-ranking.schema';
export * from './contest-participation.schema';
export * from './contest-public-ranking-link.schema';
export * from './contest-submission.schema';
export * from './contest-tag.schema';
export * from './contest.schema';
export * from './flatpage.schema';
export * from './general-issue.schema';
export * from './group.schema';
export * from './judge.schema';
export * from './language.schema';
export * from './license.schema';
export * from './misc-config.schema';
export * from './navigation-item.schema';
export * from './notification.schema';
export * from './organization-request.schema';
export * from './organization.schema';
export * from './problem-data.schema';
export * from './problem-group.schema';
export * from './problem-type.schema';
export * from './problem.schema';
export * from './rating.schema';
export * from './revision.schema';
export * from './setting-revision.schema';
export * from './setting.schema';
export * from './similarity-pair.schema';
export * from './similarity-run.schema';
export * from './submission-source.schema';
export * from './submission.schema';
export * from './tag-group.schema';
export * from './tag-problem.schema';
export * from './tag.schema';
export * from './ticket.schema';
export * from './user-activity.schema';
export * from './user-session.schema';
export * from './user.schema';
export const SCHEMAS: ModelDefinition[] = [
  { name: ActivationKey.name, schema: ActivationKeySchema },
  { name: Flatpage.name, schema: FlatpageSchema },
  { name: GeneralIssue.name, schema: GeneralIssueSchema },
  { name: MiscConfig.name, schema: MiscConfigSchema },
  { name: NavigationItem.name, schema: NavigationItemSchema },
  { name: Notification.name, schema: NotificationSchema },
  { name: Ticket.name, schema: TicketSchema },
  { name: UserActivity.name, schema: UserActivitySchema },
  { name: UserSession.name, schema: UserSessionSchema },
  { name: ContestAnnouncement.name, schema: ContestAnnouncementSchema },
  { name: ContestOfficialRanking.name, schema: ContestOfficialRankingSchema },
  {
    name: ContestPublicRankingLink.name,
    schema: ContestPublicRankingLinkSchema,
  },
  { name: BlogPost.name, schema: BlogPostSchema },
  { name: BlogVote.name, schema: BlogVoteSchema },
  { name: CommentLock.name, schema: CommentLockSchema },
  { name: CommentVote.name, schema: CommentVoteSchema },
  { name: Comment.name, schema: CommentSchema },
  { name: Contest.name, schema: ContestSchema },
  { name: ContestParticipation.name, schema: ContestParticipationSchema },
  { name: ContestSubmission.name, schema: ContestSubmissionSchema },
  { name: ContestTag.name, schema: ContestTagSchema },
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
  { name: SettingRevision.name, schema: SettingRevisionSchema },
  { name: Setting.name, schema: SettingSchema },
  { name: SimilarityPair.name, schema: SimilarityPairSchema },
  { name: SimilarityRun.name, schema: SimilarityRunSchema },
  { name: SubmissionSource.name, schema: SubmissionSourceSchema },
  { name: Submission.name, schema: SubmissionSchema },
  { name: TagGroup.name, schema: TagGroupSchema },
  { name: TagProblem.name, schema: TagProblemSchema },
  { name: Tag.name, schema: TagSchema },
  { name: User.name, schema: UserSchema },
];
