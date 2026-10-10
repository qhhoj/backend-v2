import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiEventStream } from '@libs/common';
import { ResyncFrame } from '../../events/dto/resync-frame.response';
import { NotificationFrame } from './dto/notification-frame.response';
import { UserStreamsService } from './user-streams.service';

/** Server-sent events; see `ContestStreamsController`. */
@ApiTags('Live events')
@Controller('api/internal/events/user')
export class UserStreamsController {
  constructor(private readonly streams: UserStreamsService) {}

  /**
   * Stream my notification events
   *
   * @remarks
   * Signed-in callers only. Server-sent events (`text/event-stream`). The server starts with `retry: 3000` (reconnect after 3 seconds), then sends a `: ping` comment every 15 seconds, a `notification` frame (`data` is `{"id": "<notification id>"}`) whenever a row of the caller's inbox is created or merged, and a `resync` frame after the server lost its subscription (reload the inbox then). There is no replay: fetch the inbox after connecting.
   * At most 12 streams per user, 16 per IP and 2000 user streams in total (429 `rate_limited`). The session is re-checked every minute; the stream ends when the session, the account or the API token is no longer valid.
   */
  @ApiEventStream(NotificationFrame, ResyncFrame)
  @Get()
  open(
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): void {
    this.streams.openUser(auth, request, reply);
  }
}
