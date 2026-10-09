import { Injectable } from '@nestjs/common';
import { MapCtx, MappedDocument, Mapper } from '../../mapper';

interface Row {
  id: number;
  token: string;
  status: string;
  expiry_mode: string;
  expiry_amount: number | null;
  expires_at: Date | null;
  regenerated_at: Date | null;
  contest_id: number;
}

@Injectable()
export class ContestRankingLinksMapper implements Mapper<Row> {
  name = 'contest-ranking-links';
  collection = 'contestPublicRankingLinks';
  refTables = ['judge_contestpublicrankinglink', 'judge_contest'];
  sql =
    'SELECT id, token, status, expiry_mode, expiry_amount, expires_at, regenerated_at, contest_id FROM judge_contestpublicrankinglink ORDER BY id';

  map(row: Row, ctx: MapCtx): MappedDocument | null {
    const contest = ctx.refOrNull('judge_contest', row.contest_id);
    const regeneratedAt = ctx.date(row.regenerated_at);
    if (!contest || !regeneratedAt) {
      ctx.report(`skipped judge_contestpublicrankinglink:${row.id}`);
      return null;
    }
    return {
      _id: ctx.ref('judge_contestpublicrankinglink', row.id)!,
      contest,
      token: row.token,
      status: row.status,
      expiryMode: row.expiry_mode,
      expiryAmount:
        row.expiry_amount && row.expiry_amount > 0 ? row.expiry_amount : null,
      expiresAt: ctx.date(row.expires_at),
      regeneratedAt,
      createdAt: regeneratedAt,
      updatedAt: regeneratedAt,
    };
  }
}
