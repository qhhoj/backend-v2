import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { StorageService } from '@libs/common';
import { Problem, uuidStr } from '@libs/database';
import type { ContentJob, RowChange, Tally } from '../content-job';
import { writeChanges } from '../write-changes';
import {
  imageUrlsOf,
  replaceImageUrls,
  replaceUrlsInHtml,
} from './hackmd-urls';
import { ImageDownloader } from './image-downloader';
import type { DownloadedImage } from './image-downloader';

export const REHOST_OPTIONS = Symbol('REHOST_OPTIONS');
export interface RehostOptions {
  includeImgur: boolean;
}

interface Translation {
  language: string;
  description?: string;
  descriptionHtml?: string;
}

interface ProblemRow {
  _id: string;
  description?: string;
  descriptionHtml?: string;
  translations?: Translation[];
}

/** One statement text: where it lives (column paths of the text and of its HTML) and how it renders. */
interface Statement {
  textPath: string;
  htmlPath: string;
  text: string;
  html: string;
}

function statementsOf(row: ProblemRow): Statement[] {
  const own: Statement = {
    textPath: 'description',
    htmlPath: 'descriptionHtml',
    text: row.description ?? '',
    html: row.descriptionHtml ?? '',
  };
  const translated = (row.translations ?? []).map(
    (translation, index): Statement => ({
      textPath: `translations.${index}.description`,
      htmlPath: `translations.${index}.descriptionHtml`,
      text: translation.description ?? '',
      html: translation.descriptionHtml ?? '',
    }),
  );
  return [own, ...translated];
}

/** Takes every hackmd image of a problem statement (and, with `includeImgur`, imgur ones) to our media storage, and rewrites each downloaded URL, as a literal string, in both the Markdown and the stored HTML. The statement is never re-rendered, so raw HTML of a full-markup statement stays byte for byte. An image that cannot be fetched keeps its URL; the statement's other images are still re-hosted. */
@Injectable()
export class RehostHackmdImagesJob implements ContentJob {
  readonly name = 'rehost-hackmd-images';
  /** Failed downloads only: a downloaded image is not kept, so memory stays one chunk's images however long the run. */
  private readonly failures = new Map<string, { failure: string }>();

  constructor(
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
    private readonly downloader: ImageDownloader,
    private readonly storage: StorageService,
    @Inject(REHOST_OPTIONS) private readonly options: RehostOptions,
  ) {}

  async *scan(chunkSize: number, tally: Tally): AsyncGenerator<RowChange[]> {
    const hosts = this.options.includeImgur
      ? 'hackmd\\.io|imgur\\.com'
      : 'hackmd\\.io';
    const mentions = { $regex: hosts, $options: 'i' };
    const filter = {
      $or: [
        { description: mentions },
        { 'translations.description': mentions },
      ],
    };
    let after: string | null = null;
    for (;;) {
      const rows: ProblemRow[] = await this.problems
        .find(
          after === null ? filter : { $and: [filter, { _id: { $gt: after } }] },
          {
            description: 1,
            descriptionHtml: 1,
            translations: 1,
          },
        )
        .sort({ _id: 1 })
        .limit(chunkSize)
        .lean()
        .exec();
      if (!rows.length) return;
      after = uuidStr(rows[rows.length - 1]._id);
      const changes: RowChange[] = [];
      for (const row of rows) {
        const change = await this.changeOf(row, tally);
        if (change) changes.push(change);
      }
      if (changes.length) yield changes;
    }
  }

  write(changes: readonly RowChange[]): Promise<number> {
    return writeChanges(this.problems, changes);
  }

  private async changeOf(
    row: ProblemRow,
    tally: Tally,
  ): Promise<RowChange | null> {
    const before: Record<string, string> = {};
    const after: Record<string, string> = {};
    const files: DownloadedImage[] = [];
    for (const statement of statementsOf(row)) {
      const urls = imageUrlsOf(statement.text, this.options.includeImgur);
      const replacements = new Map<string, string>();
      for (const url of urls) {
        const image = await this.fetchOnce(url);
        if ('failure' in image) {
          tally(`image kept (${image.failure})`);
          continue;
        }
        files.push(image);
        replacements.set(url, this.storage.publicUrl(image.path));
      }
      if (!replacements.size) continue;
      const text = replaceImageUrls(statement.text, replacements);
      const html = replaceUrlsInHtml(statement.html, replacements);
      Object.assign(before, { [statement.textPath]: statement.text });
      Object.assign(after, { [statement.textPath]: text });
      if (html === statement.html) continue;
      Object.assign(before, { [statement.htmlPath]: statement.html });
      Object.assign(after, { [statement.htmlPath]: html });
    }
    return Object.keys(after).length
      ? { collection: 'problems', id: uuidStr(row._id), before, after, files }
      : null;
  }

  private async fetchOnce(url: string) {
    const known = this.failures.get(url);
    if (known) return known;
    const image = await this.downloader.download(
      url,
      this.options.includeImgur,
    );
    if ('failure' in image) this.failures.set(url, image);
    return image;
  }
}
