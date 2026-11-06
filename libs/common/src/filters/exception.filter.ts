import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors/app.error';
import { errorEnvelope } from '../errors/envelope';

const CODES: Record<number, string> = {
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  413: 'payload_too_large',
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
        .send(errorEnvelope(exception));
    if (exception instanceof HttpException && exception.getStatus() < 500) {
      const status = exception.getStatus();
      const code = CODES[status] ?? 'http_error';
      return reply
        .status(status)
        .send(errorEnvelope(new AppError(code, status, exception.message)));
    }
    this.logger.error({
      reqId: req.id,
      err: exception instanceof Error ? exception.stack : exception,
    });
    return reply
      .status(500)
      .send(
        errorEnvelope(
          new AppError('internal_error', 500, `Request ${req.id} failed`),
        ),
      );
  }
}
