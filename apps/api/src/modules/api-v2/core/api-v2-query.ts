import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { createValidationPipe } from '@libs/common';

/** Legacy clients send cache-busters and other unknown keys: strip them instead of rejecting. Custom decorators skip the global pipe, so this one validates alone. */
export const lenientQueryPipe = createValidationPipe({
  forbidNonWhitelisted: false,
  validateCustomDecorators: true,
});

export const ApiV2Query = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<FastifyRequest>().query,
);
