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

  catch(e: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    if (e instanceof AppError)
      return reply.status(e.status).send({
        error: {
          code: e.code,
          message: e.message,
          ...(e.fields && { fields: e.fields }),
        },
      });
    if (e instanceof HttpException && e.getStatus() < 500)
      return reply.status(e.getStatus()).send({
        error: {
          code: CODES[e.getStatus()] ?? 'http_error',
          message: e.message,
        },
      });
    this.logger.error({ reqId: req.id, err: e instanceof Error ? e.stack : e });
    return reply.status(500).send({
      error: { code: 'internal_error', message: `Request ${req.id} failed` },
    });
  }
}
