import { NestFactory } from '@nestjs/core';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { configureApp, fastifyAdapter, loadEnv } from '@libs/common';
import { AppModule } from './app.module';
import { setupOpenApi } from './openapi';

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    fastifyAdapter(env),
  );
  await configureApp(app);
  setupOpenApi(app);
  await app.listen(env.port, '0.0.0.0');
}
void bootstrap();
