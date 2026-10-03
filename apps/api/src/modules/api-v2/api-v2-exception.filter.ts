import { Catch } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@libs/common';
import { LEGACY_MESSAGES, legacyError } from './legacy-envelope';

/** `/api/v2` keeps Django's error envelope: `{ api_version, method, fetched, error: { code: <status>, message } }`. */
@Catch(AppError)
export class ApiV2ExceptionFilter implements ExceptionFilter<AppError> {
  catch(exception: AppError, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    return http
      .getResponse<FastifyReply>()
      .status(exception.status)
      .send(
        legacyError(
          request.method,
          exception.status,
          LEGACY_MESSAGES[exception.status] ?? exception.message,
        ),
      );
  }
}
