import { ApiProperty } from '@nestjs/swagger';
import {
  NOTIFICATION_KINDS,
  NOTIFICATION_PRIORITIES,
  uuidStr,
} from '@libs/database';
import type {
  Notification,
  NotificationKind,
  NotificationPriority,
} from '@libs/database';

export class NotificationResponse {
  id!: string;
  @ApiProperty({ enum: NOTIFICATION_KINDS, enumName: 'NotificationKind' })
  kind!: NotificationKind;
  title!: string;
  /** Plain text. */
  body!: string;
  /** Internal SPA path. */
  path!: string;
  @ApiProperty({
    enum: NOTIFICATION_PRIORITIES,
    enumName: 'NotificationPriority',
  })
  priority!: NotificationPriority;
  /** Events merged into this row. */
  count!: number;
  unread!: boolean;
  @ApiProperty({ type: Date, nullable: true }) readAt!: Date | null;
  createdAt!: Date;
  /** The list is ordered by this. */
  lastActivityAt!: Date;

  static from(row: Notification): NotificationResponse {
    return {
      id: uuidStr(row._id),
      kind: row.kind,
      title: row.title,
      body: row.body,
      path: row.path,
      priority: row.priority,
      count: row.count,
      unread: row.unread,
      readAt: row.readAt,
      createdAt: row.createdAt,
      lastActivityAt: row.lastActivityAt,
    };
  }
}

export class UnreadCountResponse {
  count!: number;
}
