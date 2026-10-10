import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { NOTIFICATION_KINDS, NOTIFICATION_PRIORITIES } from '@libs/database';
import type { NotificationKind, NotificationPriority } from '@libs/database';
import { toArray } from '@libs/common';

export const NOTIFICATION_STATES = ['all', 'unread', 'read'] as const;
export type NotificationState = (typeof NOTIFICATION_STATES)[number];

export class NotificationListQueryDto {
  /** Read state to show; default `all`. */
  @ApiPropertyOptional({
    enum: NOTIFICATION_STATES,
    enumName: 'NotificationState',
  })
  @IsOptional()
  @IsIn(NOTIFICATION_STATES)
  state: NotificationState = 'all';

  /** The banner asks for `state=unread&priority=high`. */
  @ApiPropertyOptional({
    enum: NOTIFICATION_PRIORITIES,
    enumName: 'NotificationPriority',
  })
  @IsOptional()
  @IsIn(NOTIFICATION_PRIORITIES)
  priority?: NotificationPriority;

  /** Repeat the parameter (`kind=ticket-new&kind=ticket-message`); the inbox "Loại" chips send the kinds of their group. */
  @ApiPropertyOptional({
    enum: NOTIFICATION_KINDS,
    enumName: 'NotificationKind',
    isArray: true,
  })
  @IsOptional()
  @Transform(toArray)
  @ArrayMaxSize(NOTIFICATION_KINDS.length)
  @IsIn(NOTIFICATION_KINDS, { each: true })
  kind?: NotificationKind[];

  /** Page number, starting at 1; pages hold 20 rows. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
}

/** Unvalidated: a malformed id is a 404. */
export class NotificationIdParamDto {
  /** Notification id; an unknown id gives 404. */
  @IsString() id!: string;
}
