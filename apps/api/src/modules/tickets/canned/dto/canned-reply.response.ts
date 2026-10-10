import { uuidStr } from '@libs/database';
import type { TicketCannedReply } from '@libs/database';

export class CannedReplyResponse {
  /** Id of the template. */
  id!: string;
  /** Short name of the template. */
  title!: string;
  /** With `{tên}` / `{bài}` still in it. */
  body!: string;
  /** Sort position; lower comes first. */
  order!: number;
  /** When the template was created, ISO 8601. */
  createdAt!: Date;
  /** When the template was last changed, ISO 8601. */
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
