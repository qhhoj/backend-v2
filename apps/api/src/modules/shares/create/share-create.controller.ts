import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Body, Controller, Post } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { windowName } from '@libs/common';
import { ShareSummaryResponse } from '../core/dto/share.response';
import {
  ACTIVE_SHARE_LIMIT,
  CREATE_BURST_LIMIT,
  CREATE_BURST_WINDOW_SECONDS,
  CREATE_DAILY_LIMIT,
  CREATE_DAILY_WINDOW_SECONDS,
} from '../core/rate-limits';
import {
  CreatePasteDto,
  CreateSubmissionShareDto,
} from './dto/create-share.dto';
import { PASTE_BODY_LIMIT_BYTES, PASTE_MAX_BYTES } from './paste-source';
import { ShareCreateService } from './share-create.service';

const LIMITS =
  `Both kinds share the budgets: ${CREATE_BURST_LIMIT} per ${windowName(CREATE_BURST_WINDOW_SECONDS)} and ` +
  `${CREATE_DAILY_LIMIT} per ${windowName(CREATE_DAILY_WINDOW_SECONDS)} per user (429 \`rate_limited\`), and at most ` +
  `${ACTIVE_SHARE_LIMIT} unexpired links per user (409 \`conflict\`, issue \`share_limit\`). Muted users get 403 ` +
  '`forbidden` (issue `muted`). The link is `/c/<code>`: anyone with it can read it, without signing in.';

@ApiTags('Shares')
@Controller('api/internal/shares')
export class ShareCreateController {
  constructor(private readonly creating: ShareCreateService) {}

  @ApiOperation({
    summary: 'Share a frozen copy of a submission',
    description:
      "The submission's owner only (403 `forbidden` for anyone else, 404 when it cannot be seen). Stores what a visitor may see: source, language, verdict, points, time, memory and the case results the problem shows; never checker feedback, program output or an internal error's text. A later rejudge changes nothing. Only `D` and `CE` submissions in a text language (409 `conflict`, issue `submission_not_shareable`). Refused with 403 `hidden` when the setter shows sources to owners and testers only, and 403 `contest_running` while any contest that lists the problem (or holds the submission) is running, not started, frozen or has a hidden board. " +
      LIMITS,
  })
  @Post('submissions')
  createCopy(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateSubmissionShareDto,
  ): Promise<ShareSummaryResponse> {
    return this.creating.createCopy(auth.principal, body);
  }

  @ApiOperation({
    summary: 'Paste code behind a link',
    description:
      `Signed-in users. At most ${PASTE_MAX_BYTES} bytes of UTF-8 text without NUL (400 \`validation_failed\`, issues \`source_too_large\`, \`source_empty\`, \`source_invalid\`) in a known text language (issues \`language_unknown\`, \`language_takes_file\`). Pastes cannot be tied to a contest, so they are not contest-guarded; report and takedown cover leaks. ` +
      LIMITS,
  })
  @RouteConfig({ bodyLimit: PASTE_BODY_LIMIT_BYTES })
  @Post('pastes')
  createPaste(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreatePasteDto,
  ): Promise<ShareSummaryResponse> {
    return this.creating.createPaste(auth.principal, body);
  }
}
