import { Injectable } from '@nestjs/common';
import { LegacySourceService } from '../../legacy-source.service';
import { MapCtx, MappedDocument, Mapper } from '../../mapper';
import { CommentPages, PAGE_TABLES } from './comment-pages';

type Row = { id: number; page: string };

/** v2 keeps one lock per page; legacy does not, so the first lock id per resolved page wins. */
@Injectable()
export class CommentLocksMapper implements Mapper<Row> {
  name = 'comment-locks';
  collection = 'commentLocks';
  refTables = ['judge_commentlock', ...PAGE_TABLES];
  sql = 'SELECT id, page FROM judge_commentlock ORDER BY id';
  private readonly pages = new CommentPages();
  /** Resolved page (`<type>:<legacy id>`) → the first lock id on it. */
  private owners = new Map<string, number>();

  async prepare(source: LegacySourceService) {
    await this.pages.load(source);
    this.owners = new Map();
    const locks = await source.query<Row>(this.sql);
    for (const lock of locks) {
      const key = this.pageKey(lock.page);
      if (key && !this.owners.has(key)) this.owners.set(key, lock.id);
    }
  }

  map(row: Row, ctx: MapCtx): MappedDocument | null {
    const target = this.pages.resolve(row.page);
    if (!target) {
      const why = this.pages.isBlog(row.page)
        ? 'legacy blog not migrated'
        : 'page gone';
      ctx.report(`skipped judge_commentlock:${row.id} (${why})`);
      return null;
    }
    if (this.owners.get(`${target.type}:${target.id}`) !== row.id) {
      ctx.report(`skipped judge_commentlock:${row.id} (duplicate page)`);
      return null;
    }
    return {
      _id: ctx.ref('judge_commentlock', row.id)!,
      page: { type: target.type, id: ctx.ref(target.table, target.id)! },
      createdAt: null,
      updatedAt: null,
    };
  }

  private pageKey(page: string): string | null {
    const target = this.pages.resolve(page);
    return target ? `${target.type}:${target.id}` : null;
  }
}
