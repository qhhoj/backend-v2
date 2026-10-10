import { uuidStr } from '@libs/database';
import type { Flatpage } from '@libs/database';

export class FlatpageAdminListItemResponse {
  /** Page id. */
  id!: string;
  /** Canonical URL: leading slash, no trailing slash. */
  url!: string;
  /** Page title. */
  title!: string;
  /** Only signed-in users may read the page. */
  registrationRequired!: boolean;
  /** When the page was last edited. */
  updatedAt!: Date;

  static from(page: Flatpage): FlatpageAdminListItemResponse {
    return {
      id: uuidStr(page._id),
      url: page.url,
      title: page.title,
      registrationRequired: page.registrationRequired,
      updatedAt: page.updatedAt,
    };
  }
}

export class FlatpageAdminResponse extends FlatpageAdminListItemResponse {
  /** The Markdown source. */
  content!: string;
  /** What the public page serves: rendered and sanitised. */
  contentHtml!: string;
  /** When the page was created. */
  createdAt!: Date;

  static from(page: Flatpage): FlatpageAdminResponse {
    return {
      ...FlatpageAdminListItemResponse.from(page),
      content: page.content,
      contentHtml: page.contentHtml,
      createdAt: page.createdAt,
    };
  }
}
