import { Controller, Get, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiEventStream } from '@libs/common';
import { ResyncFrame } from '../../events/dto/resync-frame.response';
import { NotificationFrame } from './dto/notification-frame.response';
import { UserStreamsService } from './user-streams.service';

/** Server-sent events; see `ContestStreamsController`. */
@Controller('api/internal/events/user')
export class UserStreamsController {
  constructor(private readonly streams: UserStreamsService) {}

  /** `notification` (`{ id }`: a row of the viewer's inbox was created or merged) and `resync` after a lost subscription. */
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
