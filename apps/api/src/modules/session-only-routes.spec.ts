import { Reflector } from '@nestjs/core';
import { SESSION_ONLY_ROUTE } from '@libs/auth';
import { ContestEditingController } from './contests/editing/contest-editing.controller';
import { OrganizationEditingController } from './organizations/editing/organization-editing.controller';
import { OrganizationUsageController } from './organizations/usage/organization-usage.controller';
import { ProblemLifecycleController } from './problems/lifecycle/problem-lifecycle.controller';
import { FlatpagesAdminController } from './site/admin/flatpages-admin.controller';
import { SubmissionActionsController } from './submissions/actions/submission-actions.controller';
import { UserActivityStaffController } from './user-activity/staff/user-activity-staff.controller';
import { UserDataController } from './users/data/user-data.controller';

type Controller = { prototype: object; name: string };

/** What the auth guard reads: the handler's flag, else the controller's. */
const isSessionOnly = (controller: Controller, handler: string): boolean =>
  new Reflector().getAllAndOverride<boolean>(SESSION_ONLY_ROUTE, [
    (controller.prototype as Record<string, () => unknown>)[handler],
    controller as unknown as () => unknown,
  ]) === true;

describe('routes that need a browser session', () => {
  it.each(
    (
      [
        [ProblemLifecycleController, 'remove'],
        [ProblemLifecycleController, 'purgeNow'],
        [ContestEditingController, 'remove'],
        [SubmissionActionsController, 'overrideScore'],
        [FlatpagesAdminController, 'create'],
        [FlatpagesAdminController, 'update'],
        [FlatpagesAdminController, 'delete'],
        [OrganizationEditingController, 'remove'],
        [OrganizationUsageController, 'updateQuota'],
        [UserActivityStaffController, 'list'],
        [UserActivityStaffController, 'export'],
        [UserActivityStaffController, 'userLogs'],
        [UserActivityStaffController, 'summary'],
        [UserActivityStaffController, 'liveVisitors'],
        [UserDataController, 'prepare'],
        [UserDataController, 'download'],
      ] as Array<[Controller, string]>
    ).map(([controller, handler]) => ({
      route: `${controller.name}.${handler}`,
      controller,
      handler,
    })),
  )('$route refuses API tokens', ({ controller, handler }) => {
    expect(
      typeof (controller.prototype as Record<string, unknown>)[handler],
    ).toBe('function');
    expect(isSessionOnly(controller, handler)).toBe(true);
  });
});
