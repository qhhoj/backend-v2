import { ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { CurrentAuth, RequirePermission, SessionOnly } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { DiscordWebhooksAdminService } from './discord-webhooks-admin.service';
import {
  DiscordWebhookResponse,
  SetWebhookDto,
  WebhookEventParamDto,
  WebhookSlotParamDto,
} from './dto/discord-webhook.dto';

@RequirePermission('judge.change_settings')
@ApiTags('Admin: site & settings')
@Controller('api/internal/admin/discord-webhooks')
export class DiscordWebhooksAdminController {
  constructor(private readonly webhooks: DiscordWebhooksAdminService) {}

  /**
   * List the Discord webhooks
   *
   * @remarks
   * Requires `judge.change_settings` and a superuser, like every route
   * here (403 `superuser_only` on `key` otherwise). One row for `default` and
   * each event: the masked target of its own URL (host and last 4 characters;
   * the URL itself is never returned), and whether it falls back to `default`.
   */
  @Get()
  list(@CurrentAuth() auth: AuthContext): DiscordWebhookResponse[] {
    return this.webhooks.list(auth.principal);
  }

  /**
   * Set one Discord webhook
   *
   * @remarks
   * Requires `judge.change_settings`, a superuser and a browser session (API
   * tokens are refused). Sets the URL of `default` or one event,
   * keeping the others, as a revision of the `discord.webhooks` setting.
   * Returns every row. 400 `validation_failed` for a URL the setting refuses.
   */
  @SessionOnly()
  @Put(':event')
  set(
    @CurrentAuth() auth: AuthContext,
    @Param() { event }: WebhookSlotParamDto,
    @Body() { url }: SetWebhookDto,
  ): Promise<DiscordWebhookResponse[]> {
    return this.webhooks.set(event, url, auth.principal);
  }

  /**
   * Remove one Discord webhook
   *
   * @remarks
   * Requires `judge.change_settings`, a superuser and a browser session.
   * Removes the URL of `default` or one
   * event, keeping the others; an event without its own URL then uses
   * `default`. Returns every row.
   */
  @SessionOnly()
  @Delete(':event')
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param() { event }: WebhookSlotParamDto,
  ): Promise<DiscordWebhookResponse[]> {
    return this.webhooks.remove(event, auth.principal);
  }

  /**
   * Send a test message
   *
   * @remarks
   * Requires `judge.change_settings`, a superuser and a browser session.
   * Queues a test embed for the event, sent
   * to its own URL or else `default` like a real one; delivery happens in the
   * background, so a bad URL shows in Discord (or the worker log), not here.
   * 409 `webhook_unset` when neither has a URL. Returns 204.
   */
  @SessionOnly()
  @Post(':event/test')
  @HttpCode(204)
  test(
    @CurrentAuth() auth: AuthContext,
    @Param() { event }: WebhookEventParamDto,
  ): Promise<void> {
    return this.webhooks.test(event, auth.principal);
  }
}
