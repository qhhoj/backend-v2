import { ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  CurrentAuth,
  NoImpersonation,
  RequirePermission,
  SessionOnly,
} from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import {
  CreateIntegrationClientDto,
  IntegrationClientListQueryDto,
  IntegrationClientParamDto,
} from './dto/integration-client.dto';
import {
  CreatedIntegrationClientResponse,
  IntegrationClientResponse,
} from './dto/integration-client.response';
import { IntegrationClientsService } from './integration-clients.service';

/** Credential routes: a leaked user API token or an impersonating admin must not be able to mint or revoke one. */
@SessionOnly()
@NoImpersonation()
@RequirePermission('judge.manage_integration')
@ApiTags('Sync API (integrations)')
@Controller('api/internal/integration-clients')
export class IntegrationClientsController {
  constructor(private readonly clients: IntegrationClientsService) {}

  /**
   * List integration clients
   *
   * @remarks
   * Requires `judge.manage_integration`; browser session only and not while impersonating. Returns a page of integration clients, newest first, with key prefix, scopes, allowed networks, acting user, last use, revocation and expiry. Keys are never returned.
   */
  @ApiPaginatedResponse(IntegrationClientResponse)
  @Get()
  list(
    @Query() query: IntegrationClientListQueryDto,
  ): Promise<Paginated<IntegrationClientResponse>> {
    return this.clients.list(query);
  }

  /**
   * Create an integration client
   *
   * @remarks
   * Requires `judge.manage_integration`; browser session only and not while impersonating. Creates a client and returns its key once, in `key`; only a hash is stored. The acting user must be an active non-superuser holding `judge.add_contest` and `judge.create_private_contest`. Limited to 10 clients per administrator per day.
   * Errors: 400 `validation_failed` (unknown or unfit `actsAs`, malformed CIDR, expiry in the past), 429 `rate_limited`.
   */
  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateIntegrationClientDto,
  ): Promise<CreatedIntegrationClientResponse> {
    return this.clients.create(auth.principal, body);
  }

  /**
   * Revoke an integration client
   *
   * @remarks
   * Requires `judge.manage_integration`; browser session only and not while impersonating. The key stops working on its next request. Idempotent: revoking a revoked client does nothing. 404 `not_found`. Returns 204.
   */
  @Delete(':id')
  @HttpCode(204)
  revoke(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: IntegrationClientParamDto,
  ): Promise<void> {
    return this.clients.revoke(auth.principal, id);
  }
}
