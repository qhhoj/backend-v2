import { hasPermission } from '@libs/auth';
import type { Principal } from '@libs/auth';
import type { Ticket } from '@libs/database';
import type { FilterQuery } from 'mongoose';
import { ContestAccess } from '../../contests/core/contest-access';
import type { ContestAccessView } from '../../contests/core/contest-access';
import { ProblemAccess } from '../../problems/core/problem-access';
import type { ProblemAccessView } from '../../problems/core/problem-access';

/** What the access rules read: plain strings, the linked problem's access view (null when not about a problem) and the contest it was filed from (null outside a contest). */
export interface TicketAccessView {
  creator: string;
  assignees: string[];
  problem: ProblemAccessView | null;
  contest: ContestAccessView | null;
}

const isStaff = (principal: Principal): boolean =>
  hasPermission(principal, 'judge.change_ticket');
const isAssignee = (principal: Principal, view: TicketAccessView): boolean =>
  view.assignees.includes(principal.userId);

/** Legacy `TicketMixin.get_object`: `change_ticket`, the creator, an assignee, or an editor of the linked problem; new: an editor of the contest it was filed from. */
const canSee = (principal: Principal, view: TicketAccessView): boolean =>
  isStaff(principal) ||
  view.creator === principal.userId ||
  isAssignee(principal, view) ||
  (view.problem !== null && ProblemAccess.canEdit(principal, view.problem)) ||
  (view.contest !== null && ContestAccess.canEdit(principal, view.contest));

/** Spec: notes are edited by assignees and staff only (every reader sees them). */
const canEditNotes = (principal: Principal, view: TicketAccessView): boolean =>
  isStaff(principal) || isAssignee(principal, view);

/** Spec: staff with `change_ticket` only, never on their own ticket (legacy checked a mistyped permission). */
const canMarkGood = (principal: Principal, view: TicketAccessView): boolean =>
  isStaff(principal) && view.creator !== principal.userId;

/** Legacy had no assignee editing outside the Django admin. */
const canAssign = isStaff;

/** Taking a ticket on oneself ("Nhận phiếu"): staff, an editor of the linked problem, or an editor of the contest it was filed from (both already read it). */
const canClaim = (principal: Principal, view: TicketAccessView): boolean =>
  isStaff(principal) ||
  (view.problem !== null && ProblemAccess.canEdit(principal, view.problem)) ||
  (view.contest !== null && ContestAccess.canEdit(principal, view.contest));

/** Legacy `own_ticket_filter`. */
const ownFilter = (userId: string): FilterQuery<Ticket> => ({
  $or: [{ user: userId }, { assignees: userId }],
});

export const TicketAccess = {
  isStaff,
  canSee,
  canEditNotes,
  canMarkGood,
  canAssign,
  canClaim,
  ownFilter,
};
