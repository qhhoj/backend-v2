import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { PartialType, PickType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { trim } from '../../../problems/core/dto/transforms';

/** Legacy `auth_group.name` max_length. */
export const GROUP_NAME_MAX_LENGTH = 150;
/** More than the catalog holds, with room for legacy codenames. */
const MAX_PERMISSIONS = 200;
const MAX_GROUPS = 100;

/** Codenames from `GET /admin/permissions`. */
const Codenames = () =>
  applyDecorators(
    IsOptional(),
    IsArray(),
    ArrayMaxSize(MAX_PERMISSIONS),
    ArrayUnique(),
    IsString({ each: true }),
    MaxLength(100, { each: true }),
  );
/** Role ids from `GET /admin/groups`. */
const RoleIds = () =>
  applyDecorators(
    IsOptional(),
    IsArray(),
    ArrayMaxSize(MAX_GROUPS),
    ArrayUnique(),
    IsUUID('7', { each: true }),
  );

export class CreateGroupDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(GROUP_NAME_MAX_LENGTH)
  name!: string;

  /** Codenames from the catalog; none when absent. */
  @Codenames()
  permissions?: string[];
}

/** Changes, not a snapshot, so an edit never undoes one it did not see. */
export class UpdateGroupDto extends PartialType(
  PickType(CreateGroupDto, ['name'] as const),
) {
  /** Codenames to grant; one the catalog lacks is refused. */
  @Codenames()
  addPermissions?: string[];

  /** Codenames to take away, legacy ones included. */
  @Codenames()
  removePermissions?: string[];
}

/** Changes to a user's access, not a snapshot: a role granted meanwhile (organization creation adds `Org Admin`) is kept. Absent fields stay. */
export class ChangeUserAccessDto {
  @RoleIds()
  addGroups?: string[];

  @RoleIds()
  removeGroups?: string[];

  /** Codenames to grant; one the catalog lacks is refused. */
  @Codenames()
  addPermissions?: string[];

  /** Codenames to take away, legacy ones included. */
  @Codenames()
  removePermissions?: string[];

  /** Opens the staff screens; what they allow still comes from the permissions. */
  @IsOptional()
  @IsBoolean()
  isStaff?: boolean;

  /** Holds every permission. */
  @IsOptional()
  @IsBoolean()
  isSuperuser?: boolean;
}

export class GroupIdParamDto {
  /** Id of the role. */
  @IsUUID('7') id!: string;
}
