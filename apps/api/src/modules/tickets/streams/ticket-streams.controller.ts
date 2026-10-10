import { ApiTags } from '@nestjs/swagger';
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
@ApiTags('Live events')
@Controller('api/internal/events/tickets')
export class TicketStreamsController {
  constructor(private readonly streams: TicketStreamsService) {}

  /**
   * Stream ticket events
   *
   * @remarks
   * Server-sent events (`text/event-stream`) for every ticket the caller may
   * read. Events are `new-ticket`, `ticket-message` and `ticket-status` with
   * ids only (`ticketId`, `messageId`, `open`), so the client fetches the
   * content itself; `resync` means events were lost and the client should
   * reload. Heartbeat comments every 15 seconds, access is re-checked about
   * once a minute, and the client reconnects after the advertised 3 second
   * retry delay. Open streams are capped per user and per IP (429
   * `rate_limited`).
   */
  @Get()
  @ApiEventStream(TicketEventFrame, ResyncFrame)
  feed(
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): void {
    this.streams.openFeed(auth, request, reply);
  }

  /**
   * Stream the events of one ticket
   *
   * @remarks
   * The same frames as the ticket feed, for a single ticket. The ticket's
   * detail rules apply first: 404 `not_found` for an unknown id and 403
   * `forbidden` when the caller may not read it.
   */
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
