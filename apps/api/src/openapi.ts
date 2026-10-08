import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { envelopeResponses } from '@libs/common';
import { untypeAnyJson } from './modules/settings/dto/any-json-value';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function setupOpenApi(app: NestFastifyApplication): void {
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
  const document = envelopeResponses(generated);
  app
    .getHttpAdapter()
    .getInstance()
    .get('/api/internal/openapi.json', (_request, reply) =>
      reply.send(document),
    );
}
