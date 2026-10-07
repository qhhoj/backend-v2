import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { EventStreamHub } from './event-stream-hub.service';
import { DEFAULT_STREAM_LIMITS, STREAM_LIMITS } from './stream-limits';

/** The shared SSE machinery; a channel (submissions, contests) registers itself with the hub. */
@Module({
  imports: [AuthModule],
  providers: [
    EventStreamHub,
    { provide: STREAM_LIMITS, useValue: DEFAULT_STREAM_LIMITS },
  ],
  exports: [EventStreamHub, STREAM_LIMITS],
})
export class EventsModule {}
