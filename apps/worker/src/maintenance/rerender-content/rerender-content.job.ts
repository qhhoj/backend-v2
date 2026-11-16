import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { COMMENT_DELETED_BODY } from '@libs/community';
import { BlogPost, Comment, uuidStr } from '@libs/database';
import { renderMarkdown, RenderLimitError } from '@libs/render';
import type { RenderStyle } from '@libs/render';
import type { ContentJob, RowChange, Tally } from '../content-job';
import { writeChanges } from '../write-changes';

/** A stored HTML column and the Markdown column it is rendered from. */
interface RenderedColumn {
  source: string;
  html: string;
}

interface SourceRow {
  _id: string;
  [column: string]: unknown;
}

/** Re-renders the stored HTML of every live comment (`user` style) and blog post (`blog` style) from its Markdown with the current renderer; a row whose HTML already equals the render is not a change. */
@Injectable()
export class RerenderContentJob implements ContentJob {
  readonly name = 'rerender-content';

  constructor(
    @InjectModel(Comment.name) private readonly comments: Model<Comment>,
    @InjectModel(BlogPost.name) private readonly posts: Model<BlogPost>,
  ) {}

  async *scan(chunkSize: number, tally: Tally): AsyncGenerator<RowChange[]> {
    yield* this.scanCollection(this.comments, 'comments', 'user', {
      filter: { deletedAt: null, body: { $ne: COMMENT_DELETED_BODY } },
      columns: [{ source: 'body', html: 'bodyHtml' }],
      chunkSize,
      tally,
    });
    yield* this.scanCollection(this.posts, 'blogPosts', 'blog', {
      filter: {},
      columns: [
        { source: 'content', html: 'contentHtml' },
        { source: 'summary', html: 'summaryHtml' },
      ],
      chunkSize,
      tally,
    });
  }

  write(changes: readonly RowChange[]): Promise<number> {
    return changes[0]?.collection === 'comments'
      ? writeChanges(this.comments, changes)
      : writeChanges(this.posts, changes);
  }

  private async *scanCollection<T>(
    model: Model<T>,
    collection: string,
    style: RenderStyle,
    {
      filter,
      columns,
      chunkSize,
      tally,
    }: {
      filter: Record<string, unknown>;
      columns: RenderedColumn[];
      chunkSize: number;
      tally: Tally;
    },
  ): AsyncGenerator<RowChange[]> {
    const projection = Object.fromEntries(
      columns.flatMap(({ source, html }) => [
        [source, 1],
        [html, 1],
      ]),
    );
    let after: string | null = null;
    for (;;) {
      const rows = (await model
        .find(
          (after === null
            ? filter
            : { ...filter, _id: { $gt: after } }) as never,
          projection,
        )
        .sort({ _id: 1 })
        .limit(chunkSize)
        .lean()
        .exec()) as unknown as SourceRow[];
      if (!rows.length) return;
      after = uuidStr(rows[rows.length - 1]._id);
      const changes = rows.flatMap((row) =>
        changeOf(row, { collection, style, columns, tally }),
      );
      if (changes.length) yield changes;
    }
  }
}

/** Empty or absent when nothing differs. A row that passes the render limits keeps its old HTML (counted, not fatal). */
function changeOf(
  row: SourceRow,
  {
    collection,
    style,
    columns,
    tally,
  }: {
    collection: string;
    style: RenderStyle;
    columns: RenderedColumn[];
    tally: Tally;
  },
): RowChange[] {
  const before: Record<string, string> = {};
  const after: Record<string, string> = {};
  for (const { source, html } of columns) {
    const text = textOf(row[source]);
    const old = textOf(row[html]);
    const rendered = renderOrNull(text, style, tally);
    if (rendered === null || rendered === old) continue;
    before[html] = old;
    after[html] = rendered;
  }
  return Object.keys(after).length
    ? [{ collection, id: uuidStr(row._id), before, after }]
    : [];
}

const textOf = (value: unknown): string =>
  typeof value === 'string' ? value : '';

function renderOrNull(
  text: string,
  style: RenderStyle,
  tally: Tally,
): string | null {
  if (!text) return null;
  try {
    return renderMarkdown(text, style);
  } catch (error) {
    if (!(error instanceof RenderLimitError)) throw error;
    tally('over the render limit, kept as stored');
    return null;
  }
}
