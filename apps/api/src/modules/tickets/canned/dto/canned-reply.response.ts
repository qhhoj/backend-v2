import { uuidStr } from '@libs/database';
import type { TicketCannedReply } from '@libs/database';

export class CannedReplyResponse {
  id!: string;
  title!: string;
  /** With `{tên}` / `{bài}` still in it. */
  body!: string;
  order!: number;
  createdAt!: Date;
  updatedAt!: Date;

  static from(reply: TicketCannedReply): CannedReplyResponse {
    return {
      id: uuidStr(reply._id),
      title: reply.title,
      body: reply.body,
      order: reply.order,
      createdAt: reply.createdAt,
      updatedAt: reply.updatedAt,
    };
  }
}
