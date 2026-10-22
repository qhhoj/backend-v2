import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  AllowSuperuserToken,
  CurrentAuth,
  NoImpersonation,
  PERMISSION_CATALOG,
  RequirePermission,
  SessionOnly,
} from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { RefuseNullFieldsPipe } from '@libs/common';
import { UsernameParamDto } from '../core/dto/username-params.dto';
import {
  CreateGroupDto,
  GroupIdParamDto,
  ChangeUserAccessDto,
  UpdateGroupDto,
} from './dto/access.dto';
import {
  GroupResponse,
  PermissionResponse,
  UserAccessResponse,
} from './dto/access.response';
import { GroupsAdminService } from './groups-admin.service';
import { UserAccessService } from './user-access.service';

/** Roles and permissions. Staff with `judge.change_profile` read them; only a superuser changes them. Browser session only, not while impersonating; changing a user's access also takes a superuser's API token. */
@SessionOnly()
@NoImpersonation()
@RequirePermission('judge.change_profile')
@ApiTags('Admin: users')
@Controller('api/internal/admin')
export class AccessController {
  constructor(
    private readonly groups: GroupsAdminService,
    private readonly access: UserAccessService,
  ) {}

  /**
   * List grantable permissions
   *
   * @remarks
   * Requires `judge.change_profile`. Every permission the site checks, with a category and an English label, in catalog order.
   */
  @Get('permissions')
  permissions(): PermissionResponse[] {
    return Object.entries(PERMISSION_CATALOG).map(([codename, entry]) => ({
      codename,
      ...entry,
    }));
  }

  /**
   * List roles
   *
   * @remarks
   * Requires `judge.change_profile`. Roles (legacy groups) by name, with their permissions and member count.
   */
  @Get('groups')
  listGroups(): Promise<GroupResponse[]> {
    return this.groups.list();
  }

  /**
   * Create a role
   *
   * @remarks
   * Superuser only. Members gain its permissions on their next request. Errors: 400 `validation_failed` with issue `permission_unknown`; 403 `forbidden` unless you are a superuser; 409 `conflict` with issue `group_name_taken`, or `busy` while another access change is saved.
   */
  @Post('groups')
  createGroup(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateGroupDto,
  ): Promise<GroupResponse> {
    return this.groups.create(auth.principal, dto);
  }

  /**
   * Edit a role
   *
   * @remarks
   * Superuser only. Renames the role, adds and removes permissions; members see the change on their next request. Errors: 400 `validation_failed` with issues `permission_unknown`, `added_and_removed`; 403 `forbidden` unless you are a superuser; 404 `not_found`; 409 `conflict` with issue `group_name_taken`.
   */
  @Patch('groups/:id')
  updateGroup(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: GroupIdParamDto,
    @Body(RefuseNullFieldsPipe) dto: UpdateGroupDto,
  ): Promise<GroupResponse> {
    return this.groups.update(auth.principal, id, dto);
  }

  /**
   * Get a user's roles and permissions
   *
   * @remarks
   * Requires `judge.change_profile`. The flags, roles, direct permissions and every effective permission with its source; `canEdit` says whether you may change them. Errors: 403 `forbidden` for a superuser unless you are one; 404 `not_found`.
   */
  @Get('users/:username/access')
  getAccess(
    @CurrentAuth() auth: AuthContext,
    @Param() { username }: UsernameParamDto,
  ): Promise<UserAccessResponse> {
    return this.access.get(auth.principal, username);
  }

  /**
   * Change a user's roles and permissions
   *
   * @remarks
   * Superuser only, never on your own account. Requires a browser session, or an API token of a superuser; refused while impersonating. Adds and removes roles and direct permissions and sets the staff and superuser flags; absent fields stay, and a role granted meanwhile elsewhere is kept. Applies on the user's next request. The audit record of a change made with an API token says so in its comment. Errors: 400 `validation_failed` with issues `permission_unknown` (a codename outside the catalog the user does not already hold), `group_unknown`, `added_and_removed`; 403 `forbidden` unless you are still a superuser, for yourself, or for an API token that is not a superuser's; 404 `not_found`; 409 `conflict` with issue `busy` while another access change is saved.
   */
  @AllowSuperuserToken()
  @Patch('users/:username/access')
  changeAccess(
    @CurrentAuth() auth: AuthContext,
    @Param() { username }: UsernameParamDto,
    @Body(RefuseNullFieldsPipe) dto: ChangeUserAccessDto,
  ): Promise<UserAccessResponse> {
    return this.access.change(auth.principal, username, dto, {
      viaToken: auth.viaToken,
    });
  }
}
