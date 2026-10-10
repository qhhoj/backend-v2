import { ApiProperty } from '@nestjs/swagger';

/** What the `announcement` event carries: ids only, the page fetches the announcement itself. */
export class ContestAnnouncementEventResponse {
  /** The contest the announcement belongs to. */
  contestId!: string;
  /** The new or resent announcement; fetch it from the announcements list. */
  announcementId!: string;
}

/** A new or changed announcement. */
export class ContestAnnouncementFrame {
  @ApiProperty({ enum: ['announcement'] }) event!: 'announcement';
  @ApiProperty({ type: () => ContestAnnouncementEventResponse })
  data!: ContestAnnouncementEventResponse;
}
