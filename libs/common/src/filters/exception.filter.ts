import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors/app.error';

const CODES: Record<number, string> = {
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  429: 'rate_limited',
};

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    if (exception instanceof AppError)
      return reply
        .status(exception.status)
        .headers(exception.headers ?? {})
        .send({
          error: {
            ...exception.extra,
            code: exception.code,
            message: exception.message,
            ...(exception.fields && { fields: exception.fields }),
          },
        });
    if (exception instanceof HttpException && exception.getStatus() < 500)
      return reply.status(exception.getStatus()).send({
        error: {
          code: CODES[exception.getStatus()] ?? 'http_error',
          message: exception.message,
        },
      });
    this.logger.error({
      reqId: req.id,
      err: exception instanceof Error ? exception.stack : exception,
    });
    return reply.status(500).send({
      error: { code: 'internal_error', message: `Request ${req.id} failed` },
    });
  }
}
