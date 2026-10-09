import { ApiProperty } from '@nestjs/swagger';

/** What the `announcement` event carries: ids only, the page fetches the announcement itself. */
export class ContestAnnouncementEventResponse {
  contestId!: string;
  announcementId!: string;
}

/** A new or changed announcement. */
export class ContestAnnouncementFrame {
  @ApiProperty({ enum: ['announcement'] }) event!: 'announcement';
  @ApiProperty({ type: () => ContestAnnouncementEventResponse })
  data!: ContestAnnouncementEventResponse;
}
