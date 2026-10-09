import { Injectable } from '@nestjs/common';
import type { UUID } from 'mongodb';
import { LegacySourceService } from '../../legacy-source.service';
import { groupBy, MapCtx, MappedDocument, Mapper } from '../../mapper';

type Row = {
  id: number;
  title: string;
  slug: string;
  visible: number;
  sticky: number;
  publish_on: Date;
  content: string;
  summary: string;
  og_image: string;
  global_post: number;
  organization_id: number | null;
  score: number;
};

@Injectable()
export class BlogPostsMapper implements Mapper<Row> {
  name = 'blog-posts';
  collection = 'blogPosts';
  refTables = [
    'judge_blogpost',
    'judge_profile',
    'auth_user',
    'judge_organization',
  ];
  sql = `SELECT id, title, slug, visible, sticky, publish_on, content, summary, og_image,
    global_post, organization_id, score FROM judge_blogpost ORDER BY id`;
  private authors = new Map<number, number[]>();

  async prepare(source: LegacySourceService) {
    this.authors = groupBy(
      await source.query<{ blogpost_id: number; profile_id: number }>(
        'SELECT blogpost_id, profile_id FROM judge_blogpost_authors ORDER BY id',
      ),
      'blogpost_id',
      (row) => row.profile_id,
    );
  }

  map(row: Row, ctx: MapCtx): MappedDocument {
    const where = `judge_blogpost:${row.id}`;
    return {
      _id: ctx.ref('judge_blogpost', row.id)!,
      title: row.title,
      slug: row.slug,
      authors: this.authorIds(row.id, ctx),
      organization: ctx.refOrNull('judge_organization', row.organization_id),
      visible: ctx.bool(row.visible),
      sticky: ctx.bool(row.sticky),
      globalPost: ctx.bool(row.global_post),
      publishOn: ctx.date(row.publish_on),
      content: row.content ?? '',
      contentHtml: ctx.render(row.content, 'blog', where),
      summary: row.summary ?? '',
      summaryHtml: ctx.render(row.summary, 'blog', `${where} summary`),
      ogImage: row.og_image ?? '',
      score: Number(row.score ?? 0),
      createdAt: ctx.date(row.publish_on),
      updatedAt: ctx.date(row.publish_on),
    };
  }

  private authorIds(postId: number, ctx: MapCtx): UUID[] {
    return (this.authors.get(postId) ?? [])
      .map((profileId) => ctx.refOrNull('judge_profile', profileId))
      .filter((id): id is UUID => id !== null);
  }
}
