import {
  PROPERTY_DEPS_METADATA,
  SELF_DECLARED_DEPS_METADATA,
} from '@nestjs/common/constants';
import type { Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestContainer } from '@nestjs/core';
import { apiTuning } from '../../api/src/api-tuning';
import { AppModule } from '../../api/src/app.module';
import { BridgeModule } from '../src/bridge.module';
import { MigrationsModule } from '../../worker/src/migrations/migrations.module';
import { WorkerModule } from '../../worker/src/worker.module';
import { workerTuning } from '../../worker/src/worker-tuning';
import { bridgeTuning } from '../src/bridge-tuning';
import {
  apiConfig,
  bridgeConfig,
  ENV,
  TUNING,
  workerConfig,
} from '@libs/common';
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
const ALL_TUNING = new Set(
  [apiTuning, workerTuning, bridgeTuning].flatMap((tuning) =>
    Object.keys(tuning),
  ),
);

type Process = [string, Type<unknown>, ProcessConfig<object>, object];
const PROCESSES: Process[] = [
  ['api', AppModule, apiConfig, apiTuning],
  ['worker', WorkerModule, workerConfig, workerTuning],
  ['worker migrate', MigrationsModule, workerConfig, workerTuning],
  ['bridge', BridgeModule, bridgeConfig, bridgeTuning],
];

/** The fields each class that injects `token` reads (`<name>.<field>`, its own source and its base classes'), by class name. */
async function readers(
  root: Type<unknown>,
  token: symbol,
  name: string,
  known: Set<string>,
): Promise<Map<string, string[]>> {
  const app = await NestFactory.createApplicationContext(root, {
    preview: true,
    logger: false,
  });
  const { container } = app as unknown as { container: NestContainer };
  const found = new Map<string, string[]>();
  const pattern = new RegExp(`\\b${name}\\.(\\w+)`, 'g');
  for (const module of container.getModules().values()) {
    for (const { metatype } of [
      ...module.providers.values(),
      ...module.controllers.values(),
    ]) {
      if (typeof metatype !== 'function' || !injects(metatype, token)) continue;
      const fields = [...sourceOf(metatype).matchAll(pattern)]
        .map(([, field]) => field)
        .filter((field) => known.has(field));
      found.set(metatype.name, [...new Set(fields)]);
    }
  }
  await app.close();
  return found;
}

/** The class and its base classes, whose fields the class reads too. */
function sourceOf(type: object): string {
  const sources: string[] = [];
  for (
    let current = type;
    current !== Function.prototype;
    current = Object.getPrototypeOf(current) as object
  )
    sources.push(Function.prototype.toString.call(current));
  return sources.join('\n');
}

/** A constructor parameter or a property (inherited ones too) injected with `token`. */
function injects(type: object, token: symbol): boolean {
  const params = (Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, type) ??
    []) as { param: unknown }[];
  const properties = (Reflect.getMetadata(PROPERTY_DEPS_METADATA, type) ??
    []) as { type: unknown }[];
  return (
    params.some(({ param }) => param === token) ||
    properties.some((property) => property.type === token)
  );
}

const unprovided = (readers: Map<string, string[]>, provided: object) =>
  [...readers]
    .map(([consumer, fields]) => ({
      consumer,
      fields: fields.filter((field) => !(field in provided)),
    }))
    .filter(({ fields }) => fields.length > 0);

/**
 * Lib consumers type `ENV` and `TUNING` as the part they read, so tsc cannot see which process wires them. A consumer
 * wired into a process that lacks that part gets `undefined`, and fails at first use, not at boot.
 */
describe.each(PROCESSES)('the %s process', (_name, root, config, tuning) => {
  it('provides every config field its ENV consumers read', async () => {
    const provided = config.load(MINIMAL_ENV);
    expect(
      unprovided(await readers(root, ENV, 'env', ALL_FIELDS), provided),
    ).toEqual([]);
  });

  it('provides every tuning field its TUNING consumers read', async () => {
    expect(
      unprovided(await readers(root, TUNING, 'tuning', ALL_TUNING), tuning),
    ).toEqual([]);
  });
});
