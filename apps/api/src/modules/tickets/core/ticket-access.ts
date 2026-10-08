import { hasPermission } from '@libs/auth';
import type { Principal } from '@libs/auth';
import type { Ticket } from '@libs/database';
import type { FilterQuery } from 'mongoose';
import { ProblemAccess } from '../../problems/core/problem-access';
import type { ProblemAccessView } from '../../problems/core/problem-access';

/** What the access rules read: plain strings, the linked problem's access view (null for a general ticket). */
export interface TicketAccessView {
  creator: string;
  assignees: string[];
  problem: ProblemAccessView | null;
}

const isStaff = (principal: Principal): boolean =>
  hasPermission(principal, 'judge.change_ticket');
const isAssignee = (principal: Principal, view: TicketAccessView): boolean =>
  view.assignees.includes(principal.userId);

/** Legacy `TicketMixin.get_object`: `change_ticket`, the creator, an assignee, or an editor of the linked problem. */
const canSee = (principal: Principal, view: TicketAccessView): boolean =>
  isStaff(principal) ||
  view.creator === principal.userId ||
  isAssignee(principal, view) ||
  (view.problem !== null && ProblemAccess.canEdit(principal, view.problem));

/** Spec: notes are for assignees and staff only. */
const canEditNotes = (principal: Principal, view: TicketAccessView): boolean =>
  isStaff(principal) || isAssignee(principal, view);

/** Spec: staff with `change_ticket` only, never on their own ticket (legacy checked a mistyped permission). */
const canMarkGood = (principal: Principal, view: TicketAccessView): boolean =>
  isStaff(principal) && view.creator !== principal.userId;

/** Legacy had no assignee editing outside the Django admin. */
const canAssign = isStaff;

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
  ownFilter,
};
