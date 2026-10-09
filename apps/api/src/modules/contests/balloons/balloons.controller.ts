import { Controller, Get, HttpCode, Post, Param, Query } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiExtension,
  ApiOkResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { applyDecorators } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import type { Paginated } from '@libs/common';
import { ContestKeyParamDto } from '../core/dto/contest-params.dto';
import { BalloonsService } from './balloons.service';
import {
  BalloonItemParamDto,
  BalloonPageMetaResponse,
  BalloonQueryDto,
  BalloonResponse,
} from './dto/balloons.dto';

/** `ApiPaginatedResponse` with the balloon badge counts in the meta. */
const ApiBalloonPage = () =>
  applyDecorators(
    ApiExtraModels(BalloonResponse, BalloonPageMetaResponse),
    ApiExtension('x-enveloped', true),
    ApiOkResponse({
      schema: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: {
            type: 'array',
            items: { $ref: getSchemaPath(BalloonResponse) },
          },
          meta: { $ref: getSchemaPath(BalloonPageMetaResponse) },
        },
      },
    }),
  );

@Controller('api/internal/contests/:key/balloons')
export class BalloonsController {
  constructor(private readonly balloons: BalloonsService) {}

  @Get()
  @ApiBalloonPage()
  list(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
    @Query() query: BalloonQueryDto,
  ): Promise<Paginated<BalloonResponse, BalloonPageMetaResponse>> {
    return this.balloons.list(auth.principal, key, query);
  }

  @Post(':participation/:problem/deliver')
  @HttpCode(204)
  deliver(
    @CurrentAuth() auth: AuthContext,
    @Param() { key, participation, problem }: BalloonItemParamDto,
  ): Promise<void> {
    return this.balloons.deliver(auth.principal, key, {
      participationId: participation,
      problemId: problem,
    });
  }

  @Post(':participation/:problem/undeliver')
  @HttpCode(204)
  undeliver(
    @CurrentAuth() auth: AuthContext,
    @Param() { key, participation, problem }: BalloonItemParamDto,
  ): Promise<void> {
    return this.balloons.undeliver(auth.principal, key, {
      participationId: participation,
      problemId: problem,
    });
  }
}
