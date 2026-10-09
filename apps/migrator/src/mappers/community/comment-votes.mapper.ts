import { Injectable } from '@nestjs/common';
import { LegacySourceService } from '../../legacy-source.service';
import { MapCtx, MappedDocument, Mapper } from '../../mapper';
import { CommentPages, PAGE_TABLES } from './comment-pages';
import { CommentTree } from './comment-tree';

type Row = { id: number; score: number; comment_id: number; voter_id: number };

/** Only ±1 votes of imported comments by existing voters are kept. */
@Injectable()
export class CommentVotesMapper implements Mapper<Row> {
  name = 'comment-votes';
  collection = 'commentVotes';
  refTables = [
    'judge_commentvote',
    'judge_comment',
    'judge_profile',
    'auth_user',
    ...PAGE_TABLES,
  ];
  sql =
    'SELECT id, score, comment_id, voter_id FROM judge_commentvote ORDER BY id';
  private tree = new CommentTree(new CommentPages());

  async prepare(source: LegacySourceService) {
    this.tree = new CommentTree(new CommentPages());
    await this.tree.load(source);
  }

  map(row: Row, ctx: MapCtx): MappedDocument | null {
    const voter = ctx.refOrNull('judge_profile', row.voter_id);
    if (
      !voter ||
      this.tree.skipReason(row.comment_id) !== null ||
      ![-1, 1].includes(Number(row.score))
    ) {
      ctx.report(`skipped judge_commentvote:${row.id}`);
      return null;
    }
    return {
      _id: ctx.ref('judge_commentvote', row.id)!,
      comment: ctx.ref('judge_comment', row.comment_id)!,
      voter,
      score: Number(row.score),
      createdAt: null,
      updatedAt: null,
    };
  }
}
