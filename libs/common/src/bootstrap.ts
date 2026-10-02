import { randomUUID } from 'node:crypto';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';

export const fastifyAdapter = (): FastifyAdapter =>
  new FastifyAdapter({
    genReqId: () => randomUUID(),
    requestIdHeader: 'x-request-id',
    trustProxy: true,
  });

export function configureApp(app: NestFastifyApplication): void {
  app.enableShutdownHooks();
}
