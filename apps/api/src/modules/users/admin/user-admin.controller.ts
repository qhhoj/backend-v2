import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { StaffUserResponse } from './dto/staff-user.response';
import { UserAdminQueryDto } from './dto/user-admin.dto';
import { UserAdminService } from './user-admin.service';

@RequirePermission('judge.ban_user')
@Controller('api/internal/admin/users')
export class UserAdminController {
  constructor(private readonly users: UserAdminService) {}

  @ApiPaginatedResponse(StaffUserResponse)
  @Get()
  list(
    @Query() query: UserAdminQueryDto,
  ): Promise<Paginated<StaffUserResponse>> {
    return this.users.list(query);
  }
}
