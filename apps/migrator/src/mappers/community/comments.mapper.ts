import { Injectable } from '@nestjs/common';
import { childPath } from '@libs/community';
import { uuidStr } from '@libs/database';
import type { UUID } from 'mongodb';
import { LegacySourceService } from '../../legacy-source.service';
import { MapCtx, MappedDocument, Mapper } from '../../mapper';
import { CommentPages, PAGE_TABLES } from './comment-pages';
import { CommentTree } from './comment-tree';

type Row = {
  id: number;
  time: Date;
  page: string;
  score: number;
  body: string;
  hidden: number;
  author_id: number;
  parent_id: number | null;
  revisions: number;
};

@Injectable()
export class CommentsMapper implements Mapper<Row> {
  name = 'comments';
  collection = 'comments';
  refTables = ['judge_comment', 'judge_profile', 'auth_user', ...PAGE_TABLES];
  sql = `SELECT id, time, page, score, body, hidden, author_id, parent_id, revisions
    FROM judge_comment ORDER BY id`;
  private tree = new CommentTree(new CommentPages());

  async prepare(source: LegacySourceService) {
    this.tree = new CommentTree(new CommentPages());
    await this.tree.load(source);
  }

  map(row: Row, ctx: MapCtx): MappedDocument | null {
    const reason = this.tree.skipReason(row.id);
    if (reason) {
      ctx.report(`skipped judge_comment:${row.id} (${reason})`);
      return null;
    }
    const target = this.tree.pages.resolve(row.page)!;
    const ids = this.tree
      .lineage(row.id)
      .map((legacyId) => ctx.ref('judge_comment', legacyId)!);
    const own = ids.at(-1)!;
    return {
      _id: own,
      page: { type: target.type, id: ctx.ref(target.table, target.id)! },
      author: ctx.ref('judge_profile', row.author_id)!,
      parentId: ids.length > 1 ? ids.at(-2)! : null,
      threadId: ids[0],
      path: ids.reduce<string | null>(
        (path, id) => childPath(path, uuidStr(id)),
        null,
      )!,
      body: row.body,
      bodyHtml: ctx.render(row.body, 'user', `judge_comment:${row.id}`),
      score: Number(row.score ?? 0),
      ...this.hiddenFields(row, own, ctx),
      revisions: Number(row.revisions ?? 0),
      createdAt: ctx.date(row.time),
      updatedAt: ctx.date(row.time),
    };
  }

  /** A direct hide is its own; a visible reply under a hidden comment is hidden by the nearest hidden ancestor (v2 invariant). */
  private hiddenFields(
    row: Row,
    own: UUID,
    ctx: MapCtx,
  ): { hidden: boolean; hiddenBy: UUID | null } {
    if (ctx.bool(row.hidden)) return { hidden: true, hiddenBy: own };
    const ancestor = this.tree.hiddenAncestor(row.id);
    if (ancestor === null) return { hidden: false, hiddenBy: null };
    ctx.report(
      `judge_comment:${row.id} hidden under hidden judge_comment:${ancestor}`,
    );
    return { hidden: true, hiddenBy: ctx.ref('judge_comment', ancestor) };
  }
}
