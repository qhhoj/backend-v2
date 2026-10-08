import { uuidStr } from '@libs/database';
import type { Flatpage } from '@libs/database';

export class FlatpageAdminListItemResponse {
  id!: string;
  url!: string;
  title!: string;
  registrationRequired!: boolean;
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
