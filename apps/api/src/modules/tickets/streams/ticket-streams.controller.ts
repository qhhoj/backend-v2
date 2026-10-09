import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiEventStream } from '@libs/common';
import { ResyncFrame } from '../../events/dto/resync-frame.response';
import { TicketIdParamDto } from '../core/dto/ticket-params.dto';
import { TicketEventFrame } from './dto/ticket-stream-frames.response';
import { TicketStreamsService } from './ticket-streams.service';

/** Server-sent events; see `ContestStreamsController`. */
@Controller('api/internal/events/tickets')
export class TicketStreamsController {
  constructor(private readonly streams: TicketStreamsService) {}

  /** New tickets, messages and status changes of every ticket the viewer may read (`new-ticket`, `ticket-message`, `ticket-status`; ids only); `resync` after a lost subscription. */
  @Get()
  @ApiEventStream(TicketEventFrame, ResyncFrame)
  feed(
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): void {
    this.streams.openFeed(auth, request, reply);
  }

  /** The same frames for one ticket. */
  @Get(':id')
  @ApiEventStream(TicketEventFrame, ResyncFrame)
  async ticket(
    @Param() { id }: TicketIdParamDto,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.streams.openTicket(auth, id, request, reply);
  }
}
