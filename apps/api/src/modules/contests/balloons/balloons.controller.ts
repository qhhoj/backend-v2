import { Controller, Get, HttpCode, Post, Param, Query } from '@nestjs/common';
import {
  ApiExtension,
  ApiExtraModels,
  ApiOkResponse,
  ApiTags,
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

@ApiTags('Contest editing')
@Controller('api/internal/contests/:key/balloons')
export class BalloonsController {
  constructor(private readonly balloons: BalloonsService) {}

  /**
   * List the balloon queue of a contest
   *
   * @remarks
   * For contests with balloons on, available to editors and the balloon
   * volunteers they listed; a volunteer who is also a contestant is refused
   * (403 `contestant_forbidden`, and `balloons_forbidden` for others, 404
   * `balloons_off` when balloons are off). The queue is derived from the live
   * solves; filter with `state` (pending by default, delivered or all) and
   * page with `page` and `pageSize`. While the contest is frozen readers who
   * cannot edit get no solve times or totals, and each such read is audited.
   */
  @Get()
  @ApiBalloonPage()
  list(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
    @Query() query: BalloonQueryDto,
  ): Promise<Paginated<BalloonResponse, BalloonPageMetaResponse>> {
    return this.balloons.list(auth.principal, key, query);
  }

  /**
   * Mark a balloon as delivered
   *
   * @remarks
   * Marks the balloon for a team's solved problem as delivered and returns
   * 204. Fails with 409 `already_delivered` if it already was. Same access as
   * the queue; writes are rate limited per user.
   */
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

  /**
   * Mark a balloon as not delivered
   *
   * @remarks
   * Reverts a delivery and returns 204. Fails with 409 `not_delivered` if the
   * balloon was not delivered. Same access as the queue; writes are rate
   * limited per user.
   */
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
