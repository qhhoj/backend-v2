import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { envelopeResponses } from '@libs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function setupOpenApi(app: NestFastifyApplication): void {
  const document = envelopeResponses(
    SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('QHHOJ internal API')
        .setVersion('1')
        .addCookieAuth('qhhoj_session')
        .addBearerAuth()
        .build(),
    ),
  );
  app
    .getHttpAdapter()
    .getInstance()
    .get('/api/internal/openapi.json', (_request, reply) =>
      reply.send(document),
    );
}
