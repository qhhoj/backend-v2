import { hasPermission } from '@libs/auth';
import type { Permission, Principal } from '@libs/auth';
import { contestPhase, isFrozen } from '@libs/contests';
import type { ContestTimes } from '@libs/contests';
import { uuidStr } from '@libs/database';
import type { Contest, ScoreboardVisibility } from '@libs/database';
import type { FilterQuery } from 'mongoose';

export interface ContestAccessView extends ContestTimes {
  isVisible: boolean;
  isPrivate: boolean;
  isOrganizationPrivate: boolean;
  organizations: string[];
  privateContestants: string[];
  authors: string[];
  curators: string[];
  testers: string[];
  viewContestScoreboard: string[];
  scoreboardVisibility: ScoreboardVisibility;
  showSubmissionList: boolean;
}

/** What only the viewer's participations tell (`ContestViewerService`). */
export interface ViewerFacts {
  /** Legacy `is_in_contest`: the current participation is in this contest, which has started (or the viewer spectates). */
  inContest: boolean;
  /** Legacy `has_completed_contest`: the viewer's live participation has ended. */
  completedLive: boolean;
}
export const NO_FACTS: ViewerFacts = { inContest: false, completedLive: false };

/** Plain-string view of a contest document (UUID arrays on hydrated documents are buffers under `.map`). */
function accessView(contest: Contest): ContestAccessView {
  const ids = (values: readonly string[] | undefined) =>
    (values ?? []).map(uuidStr);
  return {
    isVisible: contest.isVisible,
    isPrivate: contest.isPrivate,
    isOrganizationPrivate: contest.isOrganizationPrivate,
    organizations: ids(contest.organizations),
    privateContestants: ids(contest.privateContestants),
    authors: ids(contest.authors),
    curators: ids(contest.curators),
    testers: ids(contest.testers),
    viewContestScoreboard: ids(contest.viewContestScoreboard),
    scoreboardVisibility: contest.scoreboardVisibility,
    showSubmissionList: contest.showSubmissionList,
    startTime: contest.startTime,
    endTime: contest.endTime,
    timeLimit: contest.timeLimit,
    frozenLastMinutes: contest.frozenLastMinutes,
    formatName: contest.formatName,
  };
}

const has = (principal: Principal | null, permission: Permission) =>
  principal !== null && hasPermission(principal, permission);
/** Legacy `editor_ids`: authors and curators. */
const isEditor = (principal: Principal | null, contest: ContestAccessView) =>
  principal !== null &&
  (contest.authors.includes(principal.userId) ||
    contest.curators.includes(principal.userId));
const isTester = (principal: Principal | null, contest: ContestAccessView) =>
  principal !== null && contest.testers.includes(principal.userId);
const seesEveryContest = (principal: Principal | null) =>
  has(principal, 'judge.see_private_contest') ||
  has(principal, 'judge.edit_all_contest');

/** Legacy `is_editable_by`. */
const canEdit = (principal: Principal | null, contest: ContestAccessView) =>
  has(principal, 'judge.edit_all_contest') ||
  (has(principal, 'judge.edit_own_contest') && isEditor(principal, contest));

/** Legacy `access_check`. */
function canSee(
  principal: Principal | null,
  contest: ContestAccessView,
): boolean {
  if (!principal)
    return (
      contest.isVisible && !contest.isPrivate && !contest.isOrganizationPrivate
    );
  if (
    seesEveryContest(principal) ||
    isEditor(principal, contest) ||
    isTester(principal, contest)
  )
    return true;
  if (!contest.isVisible) return false;
  if (!contest.isPrivate && !contest.isOrganizationPrivate) return true;
  if (contest.viewContestScoreboard.includes(principal.userId)) return true;
  const inOrganization = contest.organizations.some((organizationId) =>
    principal.organizationIds.includes(organizationId),
  );
  const listed = contest.privateContestants.includes(principal.userId);
  return (
    (!contest.isOrganizationPrivate || inOrganization) &&
    (!contest.isPrivate || listed)
  );
}

/** Mongo filter with exactly `canSee`'s semantics (legacy `get_visible_contests`), for lists. */
function visibleFilter(principal: Principal | null): FilterQuery<Contest> {
  if (!principal)
    return { isVisible: true, isPrivate: false, isOrganizationPrivate: false };
  if (seesEveryContest(principal)) return {};
  const { userId, organizationIds } = principal;
  return {
    $or: [
      {
        isVisible: true,
        $or: [
          { viewContestScoreboard: userId },
          { isPrivate: false, isOrganizationPrivate: false },
          {
            isPrivate: true,
            isOrganizationPrivate: false,
            privateContestants: userId,
          },
          {
            isPrivate: false,
            isOrganizationPrivate: true,
            organizations: { $in: organizationIds },
          },
          {
            isPrivate: true,
            isOrganizationPrivate: true,
            organizations: { $in: organizationIds },
            privateContestants: userId,
          },
        ],
      },
      { authors: userId },
      { curators: userId },
      { testers: userId },
    ],
  };
}

/** Mongo filter with `canSeeFullScoreboard`'s semantics for a list, minus the viewer's own participations (`P` boards stay hidden until the end). */
function scoreboardFilter(
  principal: Principal | null,
  now: Date,
): FilterQuery<Contest> {
  if (seesEveryContest(principal)) return {};
  return {
    $or: [
      { scoreboardVisibility: 'V', startTime: { $lte: now } },
      { scoreboardVisibility: { $in: ['C', 'P'] }, endTime: { $lt: now } },
      ...(principal
        ? [
            { authors: principal.userId },
            { curators: principal.userId },
            { viewContestScoreboard: principal.userId },
          ]
        : []),
    ],
  };
}

/** Legacy `show_scoreboard`. */
function showScoreboard(contest: ContestAccessView, now: Date): boolean {
  const phase = contestPhase(contest, now);
  if (contest.scoreboardVisibility === 'H' || phase === 'upcoming')
    return false;
  return !(
    ['C', 'P'].includes(contest.scoreboardVisibility) && phase !== 'ended'
  );
}

/** Legacy `can_see_full_scoreboard`. */
function canSeeFullScoreboard(
  principal: Principal | null,
  contest: ContestAccessView,
  now: Date,
  facts: ViewerFacts,
): boolean {
  if (showScoreboard(contest, now)) return true;
  if (!principal) return false;
  if (seesEveryContest(principal) || isEditor(principal, contest)) return true;
  if (contest.viewContestScoreboard.includes(principal.userId)) return true;
  return contest.scoreboardVisibility === 'P' && facts.completedLive;
}

/** Legacy `can_see_own_scoreboard`. */
function canSeeOwnScoreboard(
  principal: Principal | null,
  contest: ContestAccessView,
  now: Date,
  facts: ViewerFacts,
): boolean {
  if (canSeeFullScoreboard(principal, contest, now, facts)) return true;
  if (contestPhase(contest, now) === 'upcoming') return false;
  return showScoreboard(contest, now) || facts.inContest || facts.completedLive;
}

/** Legacy `can_see_full_submission_list`: never during a freeze for non-editors (legacy's own comment: the list has no freeze logic). */
function canSeeFullSubmissionList(
  principal: Principal | null,
  contest: ContestAccessView,
  now: Date,
  facts: ViewerFacts,
): boolean {
  if (!canSeeFullScoreboard(principal, contest, now, facts)) return false;
  if (isEditor(principal, contest) || has(principal, 'judge.edit_all_contest'))
    return true;
  if (isFrozen(contest, now)) return false;
  return contestPhase(contest, now) === 'ended' || contest.showSubmissionList;
}

export const ContestAccess = {
  accessView,
  isEditor,
  isTester,
  canEdit,
  canSee,
  visibleFilter,
  scoreboardFilter,
  showScoreboard,
  canSeeFullScoreboard,
  canSeeOwnScoreboard,
  canSeeFullSubmissionList,
};
