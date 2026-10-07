import type { ContestAnnouncement } from '@libs/database';

export class AnnouncementResponse {
  id!: string;
  title!: string;
  description!: string;
  descriptionHtml!: string;
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
