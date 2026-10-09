import { Module } from '@nestjs/common';
import { NotificationsModule } from '@libs/community';
import { EventsModule } from '../../events/events.module';
import { UserStreamsController } from './user-streams.controller';
import { UserStreamsService } from './user-streams.service';

@Module({
  imports: [EventsModule, NotificationsModule],
  controllers: [UserStreamsController],
  providers: [UserStreamsService],
})
export class NotificationStreamsModule {}
