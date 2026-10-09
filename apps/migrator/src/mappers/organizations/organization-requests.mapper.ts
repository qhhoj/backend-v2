import { Injectable } from '@nestjs/common';
import { LegacySourceService } from '../../legacy-source.service';
import { MapCtx, MappedDocument, Mapper } from '../../mapper';

type Row = {
  id: number;
  time: Date;
  state: string;
  reason: string;
  organization_id: number;
  user_id: number;
};

/** One rule for blank: the same test decides which pending request is kept and which is skipped. */
const isBlank = (reason: string | null): boolean => !reason?.trim();

@Injectable()
export class OrganizationRequestsMapper implements Mapper<Row> {
  name = 'organization-requests';
  collection = 'organizationRequests';
  refTables = [
    'judge_organizationrequest',
    'judge_organization',
    'judge_profile',
    'auth_user',
  ];
  sql =
    'SELECT id, time, state, reason, organization_id, user_id FROM judge_organizationrequest ORDER BY id';
  /** The first pending request per (organization, user), with a non-blank reason: v2's partial unique index allows one. */
  private firstPending = new Set<number>();

  async prepare(source: LegacySourceService) {
    const pending = await source.query<Row>(
      "SELECT id, reason, organization_id, user_id FROM judge_organizationrequest WHERE state = 'P' ORDER BY id",
    );
    const firstByPair = new Map<string, number>();
    for (const row of pending) {
      const pair = `${row.organization_id}:${row.user_id}`;
      if (!isBlank(row.reason) && !firstByPair.has(pair))
        firstByPair.set(pair, Number(row.id));
    }
    this.firstPending = new Set(firstByPair.values());
  }

  map(row: Row, ctx: MapCtx): MappedDocument | null {
    const reason = this.skipReason(row, ctx);
    if (reason) {
      ctx.report(`skipped judge_organizationrequest:${row.id} (${reason})`);
      return null;
    }
    return {
      _id: ctx.ref('judge_organizationrequest', row.id)!,
      organization: ctx.ref('judge_organization', row.organization_id)!,
      user: ctx.ref('judge_profile', row.user_id)!,
      state: row.state,
      reason: row.reason,
      decidedBy: null,
      decidedAt: null,
      createdAt: ctx.date(row.time),
      updatedAt: ctx.date(row.time),
    };
  }

  /** Legacy kept no decider, so every request is undecided here; a request is refused when its parents are gone, its reason is blank, or a later pending request for the same pair is kept. */
  private skipReason(row: Row, ctx: MapCtx): string | null {
    const organization = ctx.refOrNull(
      'judge_organization',
      row.organization_id,
    );
    const user = ctx.refOrNull('judge_profile', row.user_id);
    if (!organization || !user) return 'organization or user missing';
    if (isBlank(row.reason)) return 'empty reason';
    return row.state === 'P' && !this.firstPending.has(row.id)
      ? 'duplicate pending'
      : null;
  }
}
