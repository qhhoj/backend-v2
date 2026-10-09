import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, type FieldIssue } from '../errors/app.error';

const CODES: Record<number, string> = {
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  413: 'payload_too_large',
  429: 'rate_limited',
};

/** Error code to the issue code clients branch on, where they differ. */
const ISSUE_CODES: Record<string, string> = { unauthorized: 'unauthenticated' };

/** The `issues[]` of a refusal raised without any (guards, limiter, policy): one request-level issue named after its code, so every 4xx carries the contract's shape. */
const defaultIssues = (code: string, message: string): FieldIssue[] => [
  { field: '', code: ISSUE_CODES[code] ?? code, message },
];

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
            ...(exception.status < 500 && {
              issues: defaultIssues(exception.code, exception.message),
            }),
            ...exception.extra,
            code: exception.code,
            message: exception.message,
            ...(exception.fields && { fields: exception.fields }),
          },
        });
    if (exception instanceof HttpException && exception.getStatus() < 500) {
      const code = CODES[exception.getStatus()] ?? 'http_error';
      return reply.status(exception.getStatus()).send({
        error: {
          code,
          message: exception.message,
          issues: defaultIssues(code, exception.message),
        },
      });
    }
    this.logger.error({
      reqId: req.id,
      err: exception instanceof Error ? exception.stack : exception,
    });
    return reply.status(500).send({
      error: { code: 'internal_error', message: `Request ${req.id} failed` },
    });
  }
}
