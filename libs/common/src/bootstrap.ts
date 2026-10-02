import { randomUUID } from 'node:crypto';
import { Reflector } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppExceptionFilter } from './filters/exception.filter';
import { ResponseInterceptor } from './interceptors/response.interceptor';
import { validationPipe } from './validation';

export const fastifyAdapter = () =>
  new FastifyAdapter({
    genReqId: () => randomUUID(),
    requestIdHeader: 'x-request-id',
    trustProxy: true,
  });

export function configureApp(app: NestFastifyApplication): void {
  app.enableShutdownHooks();
  app.useGlobalPipes(validationPipe);
  app.useGlobalFilters(new AppExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector)));
}
