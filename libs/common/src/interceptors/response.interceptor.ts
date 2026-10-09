import {
  applyDecorators,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiExtension } from '@nestjs/swagger';
import { map } from 'rxjs';
import type { PageMetaResponse } from '../openapi/page-meta.response';

const RAW_RESPONSE = 'rawResponse';
export const RawResponse = () =>
  applyDecorators(SetMetadata(RAW_RESPONSE, true), ApiExtension('x-raw', true));

/** A page of `items`; `M` is the meta class the route documents (`PageMetaResponse` unless `ApiHasMoreResponse` / a cursor class says otherwise), so a mismatching meta fails the typecheck. */
export class Paginated<T, M extends object = PageMetaResponse> {
  constructor(
    readonly items: T[],
    readonly meta: M,
  ) {}
}

const envelope = ({ items, meta }: Paginated<unknown, object>) => ({
  data: items,
  meta,
});

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler) {
    if (
      this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE, [
        ctx.getHandler(),
        ctx.getClass(),
      ])
    )
      return next.handle();
    return next
      .handle()
      .pipe(
        map((result: unknown) =>
          result instanceof Paginated
            ? envelope(result as Paginated<unknown, object>)
            : { data: result },
        ),
      );
  }
}
