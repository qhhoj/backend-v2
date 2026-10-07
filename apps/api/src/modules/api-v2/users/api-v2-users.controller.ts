import { Controller, Get, Param, UseFilters } from '@nestjs/common';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { RawResponse } from '@libs/common';
import { UsernameParamDto } from '../../users/core/dto/username-params.dto';
import { ApiV2ExceptionFilter } from '../core/api-v2-exception.filter';
import { ApiV2Query, lenientQueryPipe } from '../core/api-v2-query';
import { legacyEnvelope } from '../core/legacy-envelope';
import { ApiV2UsersService } from './api-v2-users.service';
import { ApiV2UserListDto } from './dto/api-v2-user-list.dto';

@Public()
@RawResponse()
@UseFilters(ApiV2ExceptionFilter)
@Controller('api/v2')
export class ApiV2UsersController {
  constructor(private readonly users: ApiV2UsersService) {}

  @Get('users')
  async list(
    @ApiV2Query(lenientQueryPipe) query: ApiV2UserListDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ) {
    return legacyEnvelope(
      'get',
      await this.users.list(optionalPrincipal(auth), query),
    );
  }

  @Get('user/:username')
  async detail(
    @Param() { username }: UsernameParamDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ) {
    return legacyEnvelope('get', {
      object: await this.users.detail(optionalPrincipal(auth), username),
    });
  }
}
