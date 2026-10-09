import { ApiProperty } from '@nestjs/swagger';

/** Payload of a `notification` frame: the row id only, the page reads the row through the inbox. */
export class NotificationEventResponse {
  id!: string;
}

export class NotificationFrame {
  @ApiProperty({ enum: ['notification'] }) event!: 'notification';
  @ApiProperty() data!: NotificationEventResponse;
}
