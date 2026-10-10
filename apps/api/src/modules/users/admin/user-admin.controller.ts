import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { StaffUserResponse } from './dto/staff-user.response';
import { UserAdminQueryDto } from './dto/user-admin.dto';
import { UserAdminService } from './user-admin.service';

@RequirePermission('judge.ban_user')
@ApiTags('Admin: users')
@Controller('api/internal/admin/users')
export class UserAdminController {
  constructor(private readonly users: UserAdminService) {}

  /**
   * List users for staff
   *
   * @remarks
   * Requires `judge.ban_user`. Returns a page of users with moderation details (never email addresses or credentials). Filter by `search` (username prefix) and `banned`; sort by last access. Without a sort, a search is ordered by username and the rest by newest account.
   */
  @ApiPaginatedResponse(StaffUserResponse)
  @Get()
  list(
    @Query() query: UserAdminQueryDto,
  ): Promise<Paginated<StaffUserResponse>> {
    return this.users.list(query);
  }
}
