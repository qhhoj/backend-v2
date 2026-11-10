import { SELF_DECLARED_DEPS_METADATA } from '@nestjs/common/constants';
import type { Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestContainer } from '@nestjs/core';
import { AppModule } from '../../api/src/app.module';
import { BridgeModule } from '../src/bridge.module';
import { MigrationsModule } from '../../worker/src/migrations/migrations.module';
import { WorkerModule } from '../../worker/src/worker.module';
import { apiConfig, bridgeConfig, ENV, workerConfig } from '@libs/common';
import type { ProcessConfig } from '@libs/common';

const MINIMAL_ENV = {
  MONGO_URL: 'mongodb://x',
  REDIS_URL: 'redis://x',
  ENCRYPTION_KEY: 'ab'.repeat(32),
  SITE_URL: 'https://x',
  TOKEN_SECRET: 'x'.repeat(32),
  SESSION_SECRET: 'y'.repeat(32),
  MEDIA_ROOT: '/m',
  PROBLEM_DATA_ROOT: '/p',
  PDF_CACHE_ROOT: '/c',
};

/** Every field any process loads, so a read of `env.<field>` can be told from `env.<anything else>`. */
const ALL_FIELDS = new Set(
  [apiConfig, workerConfig, bridgeConfig].flatMap((config) =>
    Object.keys(config.load(MINIMAL_ENV)),
  ),
);

type Process = [string, Type<unknown>, ProcessConfig<object>];
const PROCESSES: Process[] = [
  ['api', AppModule, apiConfig],
  ['worker', WorkerModule, workerConfig],
  ['worker migrate', MigrationsModule, workerConfig],
  ['bridge', BridgeModule, bridgeConfig],
];

/** The config fields each class that injects `ENV` reads (`env.<field>`, constructor and methods), by class name. */
async function envReaders(root: Type<unknown>): Promise<Map<string, string[]>> {
  const app = await NestFactory.createApplicationContext(root, {
    preview: true,
    logger: false,
  });
  const { container } = app as unknown as { container: NestContainer };
  const readers = new Map<string, string[]>();
  for (const module of container.getModules().values()) {
    for (const { metatype } of [
      ...module.providers.values(),
      ...module.controllers.values(),
    ]) {
      if (typeof metatype !== 'function' || !injectsEnv(metatype)) continue;
      const fields = [...metatype.toString().matchAll(/\benv\.(\w+)/g)]
        .map(([, field]) => field)
        .filter((field) => ALL_FIELDS.has(field));
      readers.set(metatype.name, [...new Set(fields)]);
    }
  }
  await app.close();
  return readers;
}

function injectsEnv(type: object): boolean {
  const declared = (Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, type) ??
    []) as { param: unknown }[];
  return declared.some(({ param }) => param === ENV);
}

/**
 * Lib consumers type `ENV` as the part they read, so tsc cannot see which process wires them. A consumer wired into
 * a process whose config lacks that part gets `undefined`, and fails at first use, not at boot.
 */
describe.each(PROCESSES)('the %s process', (_name, root, config) => {
  it('provides every config field its ENV consumers read', async () => {
    const provided = new Set(Object.keys(config.load(MINIMAL_ENV)));
    const missing = [...(await envReaders(root))]
      .map(([consumer, fields]) => ({
        consumer,
        fields: fields.filter((field) => !provided.has(field)),
      }))
      .filter(({ fields }) => fields.length > 0);
    expect(missing).toEqual([]);
  });
});
