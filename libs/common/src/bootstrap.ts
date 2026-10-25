import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Reflector } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppExceptionFilter } from './filters/exception.filter';
import { ResponseInterceptor } from './interceptors/response.interceptor';
import { validationPipe } from './pipes/validation.pipe';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Legacy `SUBMISSION_FILE_UPLOAD_MEDIA_DIR`: file-only submissions live at `<dir>/<problem code>/<user id>/<random>.<extension>` under the media root; the api writes them, the bridge reads them. */
export const SUBMISSION_FILE_DIR = 'submission_file';

/** Nest's ValidationPipe recurses over the body and overflows the stack on hostile nesting; no endpoint needs this depth. */
const MAX_BODY_DEPTH = 32;

function isTooDeep(body: unknown): boolean {
  const pending: Array<[unknown, number]> = [[body, 0]];
  for (let next = pending.pop(); next; next = pending.pop()) {
    const [value, depth] = next;
    if (typeof value !== 'object' || value === null) continue;
    if (depth >= MAX_BODY_DEPTH) return true;
    for (const child of Object.values(value)) pending.push([child, depth + 1]);
  }
  return false;
}

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

const PRIVATE_NO_STORE = 'private, no-store';

function addVaryCookie(reply: FastifyReply) {
  const vary = String(reply.getHeader('vary') ?? '');
  if (!/\bcookie\b/i.test(vary))
    reply.header('vary', vary ? `${vary}, Cookie` : 'Cookie');
}

/** Every `/api` answer says how a shared cache may treat it: no `Cache-Control` becomes `private, no-store` (a CDN caches by file extension otherwise), and a `private, max-age` answer varies by `Cookie`, so a browser never replays one user's answer to the next sign-in. */
function setApiCacheHeaders(request: FastifyRequest, reply: FastifyReply) {
  if (!request.url.startsWith('/api/')) return;
  const cacheControl = reply.getHeader('cache-control');
  if (cacheControl === undefined)
    reply.header('cache-control', PRIVATE_NO_STORE);
  else if (/\bmax-age=[1-9]/.test(String(cacheControl))) addVaryCookie(reply);
}

export async function configureApp(app: NestFastifyApplication): Promise<void> {
  await app.register(fastifyCookie);
  await app.register(fastifyMultipart, {
    limits: { files: 1, fields: 0, fileSize: MAX_UPLOAD_BYTES },
  });
  // `@RouteConfig({ bodyLimit })` raises Fastify's 1 MiB default for that route only.
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRoute', (route) => {
      const { bodyLimit } = (route.config ?? {}) as { bodyLimit?: number };
      if (bodyLimit) route.bodyLimit = bodyLimit;
    });
  app
    .getHttpAdapter()
    .getInstance()
    // A hook runs outside Nest's exception filter, so the error envelope is built by hand.
    .addHook('preValidation', async (request, reply) => {
      if (isTooDeep(request.body))
        await reply.status(400).send({
          error: {
            code: 'validation_failed',
            message: 'Request body is nested too deeply',
          },
        });
    });
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', async (request, reply) => {
      setApiCacheHeaders(request, reply);
    });
  app.enableShutdownHooks();
  app.useGlobalPipes(validationPipe);
  app.useGlobalFilters(new AppExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector)));
}
