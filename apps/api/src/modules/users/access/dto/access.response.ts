import { PERMISSION_CATEGORIES } from '@libs/auth';
import type { PermissionCategory } from '@libs/auth';
import { ApiProperty } from '@nestjs/swagger';
import type { GroupRow } from '../access.repository';

export class PermissionResponse {
  /** Legacy Django codename such as `judge.edit_all_problem`. */
  codename!: string;
  @ApiProperty({ enum: PERMISSION_CATEGORIES, enumName: 'PermissionCategory' })
  category!: PermissionCategory;
  /** English label; the frontend may translate by codename. */
  label!: string;
}

export class GroupResponse {
  id!: string;
  name!: string;
  /** Codenames, including legacy ones the catalog no longer lists. */
  permissions!: string[];
  /** Users in the group. */
  memberCount!: number;

  static from(group: GroupRow, memberCount: number): GroupResponse {
    return { ...group, memberCount };
  }
}

export class GroupSummaryResponse {
  id!: string;
  name!: string;
}

export class EffectivePermissionResponse {
  codename!: string;
  /** True when held directly. */
  direct!: boolean;
  /** Names of the groups granting it. */
  viaGroups!: string[];
}

export class UserAccessResponse {
  isStaff!: boolean;
  /** A superuser holds every permission whatever the lists say. */
  isSuperuser!: boolean;
  groups!: GroupSummaryResponse[];
  /** Codenames held directly. */
  permissions!: string[];
  /** Every codename held directly or through a group, by codename. */
  effective!: EffectivePermissionResponse[];
  /** Whether you may change this access: only a superuser grants or revokes, and never on their own account. */
  canEdit!: boolean;
}
