import { Controller, Get } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ApiProperty, DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { ApiEventStream, ApiNdjsonStream } from './api-event-stream';

class Payload {
  @ApiProperty() id!: string;
}
class StateFrame {
  @ApiProperty({ enum: ['state'] }) event!: 'state';
  @ApiProperty() data!: Payload;
}
class ProgressFrame {
  @ApiProperty({ enum: ['queued', 'done'] }) event!: 'queued' | 'done';
  @ApiProperty() data!: Payload;
}
@Controller('streams')
class StreamController {
  @Get()
  @ApiEventStream(StateFrame, ProgressFrame)
  stream() {
    return null;
  }

  @Get('lines')
  @ApiNdjsonStream(Payload)
  lines() {
    return null;
  }
}

async function documentOf() {
  const app = (
    await Test.createTestingModule({
      controllers: [StreamController],
    }).compile()
  ).createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().build(),
  );
  await app.close();
  return document;
}

describe('ApiEventStream', () => {
  it('documents the stream as a union of its frames, with no discriminator keyword', async () => {
    const document = await documentOf();
    const response = document.paths['/streams'].get!.responses[
      '200'
    ] as unknown as {
      content: Record<string, { schema: Record<string, unknown> }>;
    };
    const schema = response.content['text/event-stream'].schema;
    expect(schema.oneOf).toEqual([
      { $ref: '#/components/schemas/StateFrame' },
      { $ref: '#/components/schemas/ProgressFrame' },
    ]);
    // openapi-typescript replaces the tag's literals by schema names when a discriminator is present.
    expect(schema).not.toHaveProperty('discriminator');
    expect(Object.keys(document.components!.schemas!)).toEqual(
      expect.arrayContaining(['StateFrame', 'ProgressFrame', 'Payload']),
    );
  });
});

describe('ApiNdjsonStream', () => {
  it('documents the stream as NDJSON lines of one schema, not as server-sent events', async () => {
    const document = await documentOf();
    const content = (
      document.paths['/streams/lines'].get!.responses['200'] as unknown as {
        content: Record<string, { schema: Record<string, unknown> }>;
      }
    ).content;
    expect(content).toEqual({
      'application/x-ndjson': {
        schema: { $ref: '#/components/schemas/Payload' },
      },
    });
  });
});
