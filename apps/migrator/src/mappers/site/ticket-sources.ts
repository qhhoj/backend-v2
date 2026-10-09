import { LegacySourceService } from '../../legacy-source.service';
import { groupBy, MapCtx } from '../../mapper';
import { importedProblem } from '../imported-rows';

type Message = {
  id: number;
  ticket_id: number;
  body: string;
  time: Date;
  user_id: number;
};

export const TICKET_MESSAGE_CAP = 500;

/** A content type the v2 `linkedItem` can point at: its type, id-map table and the legacy ids that exist. */
type Linkable = {
  type: 'problem' | 'general';
  table: string;
  ids: Set<number>;
};

/** Lookup tables a ticket needs beyond its own row: content types, messages and assignees. */
export class TicketSources {
  private contentTypes = new Map<number, string>();
  private linkable = new Map<string, Linkable>();
  private messages = new Map<number, Message[]>();
  private assignees = new Map<number, number[]>();

  async load(source: LegacySourceService): Promise<void> {
    const types = await source.query<{ id: number; name: string }>(
      "SELECT id, CONCAT(app_label, '.', model) AS name FROM django_content_type",
    );
    this.contentTypes = new Map(types.map((row) => [row.id, row.name]));
    const idsOf = async (sql: string) =>
      new Set((await source.query<{ id: number }>(sql)).map((row) => row.id));
    this.linkable = new Map<string, Linkable>([
      [
        'judge.problem',
        {
          type: 'problem',
          table: 'judge_problem',
          ids: await idsOf(
            `SELECT p.id FROM judge_problem p ${importedProblem('p')}`,
          ),
        },
      ],
      [
        'judge.generalissue',
        {
          type: 'general',
          table: 'judge_generalissue',
          ids: await idsOf('SELECT id FROM judge_generalissue'),
        },
      ],
    ]);
    this.messages = groupBy(
      await source.query<Message>(
        'SELECT id, ticket_id, body, time, user_id FROM judge_ticketmessage ORDER BY ticket_id, time, id',
      ),
      'ticket_id',
      (row) => row,
    );
    this.assignees = groupBy(
      await source.query<{ ticket_id: number; profile_id: number }>(
        'SELECT ticket_id, profile_id FROM judge_ticket_assignees ORDER BY id',
      ),
      'ticket_id',
      (row) => row.profile_id,
    );
  }

  /** The v2 `linkedItem`, or the content type name when it cannot be linked. */
  linkOf(
    contentTypeId: number,
    objectId: number,
    ctx: MapCtx,
  ): { type: string; id: unknown } | string {
    const name =
      this.contentTypes.get(contentTypeId) ?? `content type ${contentTypeId}`;
    const linkable = this.linkable.get(name);
    if (!linkable || !linkable.ids.has(objectId)) return name;
    return { type: linkable.type, id: ctx.ref(linkable.table, objectId) };
  }

  messagesOf(ticketId: number, ctx: MapCtx) {
    const rows = this.messages.get(ticketId) ?? [];
    if (rows.length > TICKET_MESSAGE_CAP)
      ctx.report(
        `judge_ticket:${ticketId} has ${rows.length} messages (over the cap, imported whole)`,
      );
    return rows.flatMap((row) => {
      const user = ctx.refOrNull('judge_profile', row.user_id);
      if (!user || !row.body?.trim()) {
        ctx.report(`dropped judge_ticketmessage:${row.id}`);
        return [];
      }
      return [
        {
          _id: ctx.ref('judge_ticketmessage', row.id)!,
          user,
          body: row.body,
          bodyHtml: ctx.render(
            row.body,
            'user',
            `judge_ticketmessage:${row.id}`,
          ),
          createdAt: ctx.date(row.time),
        },
      ];
    });
  }

  assigneesOf(ticketId: number, ctx: MapCtx) {
    return (this.assignees.get(ticketId) ?? [])
      .map((id) => ctx.refOrNull('judge_profile', id))
      .filter((id) => id !== null);
  }
}
