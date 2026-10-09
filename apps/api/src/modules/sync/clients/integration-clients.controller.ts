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
@Controller('api/internal/integration-clients')
export class IntegrationClientsController {
  constructor(private readonly clients: IntegrationClientsService) {}

  @ApiPaginatedResponse(IntegrationClientResponse)
  @Get()
  list(
    @Query() query: IntegrationClientListQueryDto,
  ): Promise<Paginated<IntegrationClientResponse>> {
    return this.clients.list(query);
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateIntegrationClientDto,
  ): Promise<CreatedIntegrationClientResponse> {
    return this.clients.create(auth.principal, body);
  }

  @Delete(':id')
  @HttpCode(204)
  revoke(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: IntegrationClientParamDto,
  ): Promise<void> {
    return this.clients.revoke(auth.principal, id);
  }
}
