import type { Principal } from '@libs/auth';
import type { ContestAccessView } from '../../contests/core/contest-access';
import type { ProblemAccessView } from '../../problems/core/problem-access';
import { TicketAccess } from './ticket-access';
import type { TicketAccessView } from './ticket-access';

const principalWith = (permissions: string[], userId = 'me'): Principal => ({
  userId,
  username: userId,
  isSuperuser: false,
  isStaff: false,
  permissions: new Set(permissions),
  organizationIds: [],
});
const problem = (
  extra: Partial<ProblemAccessView> = {},
): ProblemAccessView => ({
  id: 'p',
  isPublic: true,
  isOrganizationPrivate: false,
  organizations: [],
  authors: [],
  curators: [],
  testers: [],
  suggester: null,
  ...extra,
});
const contest = (
  extra: Partial<ContestAccessView> = {},
): ContestAccessView => ({
  isVisible: true,
  isPrivate: false,
  isOrganizationPrivate: false,
  organizations: [],
  privateContestants: [],
  authors: [],
  curators: [],
  testers: [],
  viewContestScoreboard: [],
  balloonStaff: [],
  scoreboardVisibility: 'V',
  showSubmissionList: false,
  startTime: new Date(0),
  endTime: new Date(1),
  timeLimit: null,
  frozenLastMinutes: 0,
  formatName: 'default',
  ...extra,
});
const view = (extra: Partial<TicketAccessView> = {}): TicketAccessView => ({
  creator: 'creator',
  assignees: ['assignee'],
  problem: null,
  contest: null,
  ...extra,
});

describe('TicketAccess', () => {
  it('reads: change_ticket, creator, assignee, or an editor of the linked problem', () => {
    expect(
      TicketAccess.canSee(principalWith(['judge.change_ticket']), view()),
    ).toBe(true);
    expect(TicketAccess.canSee(principalWith([], 'creator'), view())).toBe(
      true,
    );
    expect(TicketAccess.canSee(principalWith([], 'assignee'), view())).toBe(
      true,
    );
    expect(TicketAccess.canSee(principalWith([]), view())).toBe(false);
    const linked = view({ problem: problem({ authors: ['me'] }) });
    expect(
      TicketAccess.canSee(principalWith(['judge.edit_own_problem']), linked),
    ).toBe(true);
    // listed as an author but without the edit permission: legacy `is_editable_by` is false
    expect(TicketAccess.canSee(principalWith([]), linked)).toBe(false);
    expect(
      TicketAccess.canSee(
        principalWith(['judge.edit_own_problem']),
        view({ problem: problem() }),
      ),
    ).toBe(false);
  });

  it('reads: an editor of the contest the ticket was filed from, not its testers or other contestants', () => {
    const editOwn = ['judge.edit_own_contest'];
    const filed = view({
      contest: contest({
        authors: ['author'],
        curators: ['curator'],
        testers: ['me'],
      }),
    });
    expect(TicketAccess.canSee(principalWith(editOwn, 'author'), filed)).toBe(
      true,
    );
    expect(TicketAccess.canSee(principalWith(editOwn, 'curator'), filed)).toBe(
      true,
    );
    expect(TicketAccess.canSee(principalWith(editOwn), filed)).toBe(false);
    expect(TicketAccess.canSee(principalWith([], 'author'), filed)).toBe(false);
    expect(
      TicketAccess.canSee(principalWith(['judge.edit_all_contest']), filed),
    ).toBe(true);
    expect(
      TicketAccess.canSee(principalWith(['judge.edit_all_contest']), view()),
    ).toBe(false);
  });

  it('notes: assignees and staff only', () => {
    expect(
      TicketAccess.canEditNotes(principalWith([], 'assignee'), view()),
    ).toBe(true);
    expect(
      TicketAccess.canEditNotes(principalWith(['judge.change_ticket']), view()),
    ).toBe(true);
    expect(
      TicketAccess.canEditNotes(principalWith([], 'creator'), view()),
    ).toBe(false);
    expect(
      TicketAccess.canEditNotes(
        principalWith(['judge.edit_all_problem', 'judge.edit_own_problem']),
        view({ problem: problem() }),
      ),
    ).toBe(false);
  });

  it('good toggle: staff only, never on their own ticket', () => {
    const staff = principalWith(['judge.change_ticket'], 'staff');
    expect(TicketAccess.canMarkGood(staff, view())).toBe(true);
    expect(TicketAccess.canMarkGood(staff, view({ creator: 'staff' }))).toBe(
      false,
    );
    expect(
      TicketAccess.canMarkGood(principalWith([], 'assignee'), view()),
    ).toBe(false);
    expect(
      TicketAccess.canMarkGood(
        { ...principalWith([], 'creator'), isSuperuser: true },
        view(),
      ),
    ).toBe(false);
  });
});
