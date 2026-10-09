import type { INestApplication } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { envelopeResponses } from '@libs/common';
import { untypeAnyJson } from './modules/settings/dto/any-json-value';

/** The contract of the internal API: what `GET /api/internal/openapi.json` serves and `npm run openapi:emit` writes. */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const generated = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('QHHOJ internal API')
      .setVersion('1')
      .addCookieAuth('qhhoj_session')
      .addBearerAuth()
      .build(),
  );
  untypeAnyJson(generated);
  return envelopeResponses(generated);
}

export function setupOpenApi(app: NestFastifyApplication): void {
  const document = buildOpenApiDocument(app);
  app
    .getHttpAdapter()
    .getInstance()
    .get('/api/internal/openapi.json', (_request, reply) =>
      reply.send(document),
    );
}
