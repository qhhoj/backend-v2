import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map } from 'rxjs';

const RAW_RESPONSE = 'rawResponse';
export const RawResponse = () => SetMetadata(RAW_RESPONSE, true);

export class Paginated<T> {
  constructor(
    readonly items: T[],
    readonly meta: Record<string, unknown>,
  ) {}
}

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
            ? { data: result.items, meta: result.meta }
            : { data: result },
        ),
      );
  }
}
