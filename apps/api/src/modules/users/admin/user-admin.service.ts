import { Injectable } from '@nestjs/common';
import { Paginated } from '@libs/common';
import { StaffUserResponse } from './dto/staff-user.response';
import type { UserAdminQueryDto } from './dto/user-admin.dto';
import { UserAdminRepository } from './user-admin.repository';

@Injectable()
export class UserAdminService {
  constructor(private readonly repository: UserAdminRepository) {}

  async list({
    search,
    banned,
    page,
    pageSize,
  }: UserAdminQueryDto): Promise<Paginated<StaffUserResponse>> {
    const { items, total } = await this.repository.page(
      { search, banned },
      page,
      pageSize,
    );
    return new Paginated(
      items.map((row) => StaffUserResponse.from(row)),
      {
        page,
        pageSize,
        total,
      },
    );
  }
}
