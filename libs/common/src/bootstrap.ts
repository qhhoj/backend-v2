import { randomUUID } from 'node:crypto';
import { Reflector } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppExceptionFilter } from './filters/exception.filter';
import { ResponseInterceptor } from './interceptors/response.interceptor';
import { validationPipe } from './pipes/validation.pipe';

export const fastifyAdapter = ({
  trustProxy = false,
  logLevel = 'silent',
}: { trustProxy?: false | string; logLevel?: string } = {}) =>
  new FastifyAdapter({
    logger: { level: logLevel },
    genReqId: () => randomUUID(),
    requestIdHeader: trustProxy ? 'x-request-id' : false,
    trustProxy,
  });

// async on purpose: later tasks register async plugins (cookies) here.
// eslint-disable-next-line @typescript-eslint/require-await
export async function configureApp(app: NestFastifyApplication): Promise<void> {
  app.enableShutdownHooks();
  app.useGlobalPipes(validationPipe);
  app.useGlobalFilters(new AppExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector)));
}
