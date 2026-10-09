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
  /** The first pending request per (organization, user): v2's partial unique index allows one. */
  private firstPending = new Set<number>();

  async prepare(source: LegacySourceService) {
    this.firstPending = new Set(
      (
        await source.query<{ id: number }>(
          "SELECT MIN(id) AS id FROM judge_organizationrequest WHERE state = 'P' AND TRIM(reason) <> '' GROUP BY organization_id, user_id",
        )
      ).map((row) => Number(row.id)),
    );
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

  /** Legacy kept no decider, so every request is undecided here; a request is refused when its parents are gone, its reason is empty, or a later pending request for the same pair is kept. */
  private skipReason(row: Row, ctx: MapCtx): string | null {
    const organization = ctx.refOrNull(
      'judge_organization',
      row.organization_id,
    );
    const user = ctx.refOrNull('judge_profile', row.user_id);
    if (!organization || !user) return 'organization or user missing';
    if (!row.reason?.trim()) return 'empty reason';
    return row.state === 'P' && !this.firstPending.has(row.id)
      ? 'duplicate pending'
      : null;
  }
}
