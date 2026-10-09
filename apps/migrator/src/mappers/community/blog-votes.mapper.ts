import { Injectable } from '@nestjs/common';
import { MapCtx, MappedDocument, Mapper } from '../../mapper';

type Row = { id: number; score: number; blog_id: number; voter_id: number };

/** Only ±1 votes of existing posts by existing voters are kept. */
@Injectable()
export class BlogVotesMapper implements Mapper<Row> {
  name = 'blog-votes';
  collection = 'blogVotes';
  refTables = [
    'judge_blogvote',
    'judge_blogpost',
    'judge_profile',
    'auth_user',
  ];
  sql = 'SELECT id, score, blog_id, voter_id FROM judge_blogvote ORDER BY id';

  map(row: Row, ctx: MapCtx): MappedDocument | null {
    const blog = ctx.refOrNull('judge_blogpost', row.blog_id);
    const voter = ctx.refOrNull('judge_profile', row.voter_id);
    if (!blog || !voter || ![-1, 1].includes(Number(row.score))) {
      ctx.report(`skipped judge_blogvote:${row.id}`);
      return null;
    }
    return {
      _id: ctx.ref('judge_blogvote', row.id)!,
      blog,
      voter,
      score: Number(row.score),
      createdAt: null,
      updatedAt: null,
    };
  }
}
