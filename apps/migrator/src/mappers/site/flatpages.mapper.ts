import { Injectable } from '@nestjs/common';
import { normalizeFlatpageUrl } from '@libs/community';
import { LegacySourceService } from '../../legacy-source.service';
import { MapCtx, MappedDocument, Mapper } from '../../mapper';

type Row = {
  id: number;
  url: string;
  title: string;
  content: string;
  registration_required: number;
  template_name: string;
  enable_comments: number;
};

@Injectable()
export class FlatpagesMapper implements Mapper<Row> {
  name = 'flatpages';
  collection = 'flatpages';
  refTables = ['django_flatpage'];
  sql = `SELECT id, url, title, content, registration_required, template_name, enable_comments
    FROM django_flatpage ORDER BY id`;
  /** Canonical url → the first legacy page id that has it. */
  private owners = new Map<string, number>();

  async prepare(source: LegacySourceService) {
    this.owners = new Map();
    const rows = await source.query<{ id: number; url: string }>(
      'SELECT id, url FROM django_flatpage ORDER BY id',
    );
    for (const row of rows) {
      const url = normalizeFlatpageUrl(row.url);
      if (url && !this.owners.has(url)) this.owners.set(url, row.id);
    }
  }

  map(row: Row, ctx: MapCtx): MappedDocument | null {
    const url = normalizeFlatpageUrl(row.url);
    if (!url || this.owners.get(url) !== row.id) {
      ctx.report(
        `skipped django_flatpage:${row.id} (${url ? 'duplicate url' : 'invalid url'})`,
      );
      return null;
    }
    if (row.template_name)
      ctx.report(`django_flatpage:${row.id} template_name not migrated`);
    if (!Number(row.enable_comments))
      ctx.report(`django_flatpage:${row.id} enable_comments=0 not migrated`);
    return {
      _id: ctx.ref('django_flatpage', row.id)!,
      url,
      title: row.title,
      content: row.content ?? '',
      contentHtml: ctx.render(row.content, 'blog', `django_flatpage:${row.id}`),
      registrationRequired: ctx.bool(row.registration_required),
      createdAt: null,
      updatedAt: null,
    };
  }
}
