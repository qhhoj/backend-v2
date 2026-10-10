import type { ContestAnnouncement } from '@libs/database';

export class AnnouncementResponse {
  id!: string;
  title!: string;
  /** Markdown source of the announcement. */
  description!: string;
  /** The announcement rendered to HTML. */
  descriptionHtml!: string;
  /** When the announcement was posted, ISO 8601. */
  createdAt!: string;

  static from(announcement: ContestAnnouncement): AnnouncementResponse {
    return {
      id: announcement._id,
      title: announcement.title,
      description: announcement.description,
      descriptionHtml: announcement.descriptionHtml,
      createdAt: announcement.createdAt.toISOString(),
    };
  }
}
