import { MODULE_METADATA } from '@nestjs/common/constants';
import type { DynamicModule, ForwardReference, Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type {
  OpenAPIObject,
  OperationObject,
  ParameterObject,
} from '@nestjs/swagger';
import { configureApp, fastifyAdapter } from '@libs/common';
import { AppModule } from '../../src/app.module';
import { buildOpenApiDocument } from '../../src/openapi';

type ModuleRef = Type | DynamicModule | ForwardReference;

function resolveModule(ref: ModuleRef): {
  type: Type;
  dynamic?: DynamicModule;
} {
  const resolved: Type | DynamicModule =
    'forwardRef' in ref
      ? (ref.forwardRef as () => Type | DynamicModule)()
      : ref;
  return 'module' in resolved
    ? { type: resolved.module, dynamic: resolved }
    : { type: resolved };
}

/** Every controller reachable from `root` through `imports`, each once, in import order. */
export function collectControllers(
  root: ModuleRef,
  seen = new Set<Type>(),
): Type[] {
  const { type, dynamic } = resolveModule(root);
  if (seen.has(type)) return [];
  seen.add(type);
  const own = [
    ...((Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, type) ??
      []) as Type[]),
    ...(dynamic?.controllers ?? []),
  ];
  const imports = [
    ...((Reflect.getMetadata(MODULE_METADATA.IMPORTS, type) ??
      []) as ModuleRef[]),
    ...((dynamic?.imports ?? []) as ModuleRef[]),
  ];
  return [
    ...own,
    ...imports.flatMap((child) => collectControllers(child, seen)),
  ];
}

let cached: Promise<OpenAPIObject> | undefined;

/**
 * The document `GET /api/internal/openapi.json` serves, built from the controllers alone: their providers are
 * stubs, so no server listens and no database or Redis connects. Shared between specs: do not mutate it.
 */
export function loadDocument(): Promise<OpenAPIObject> {
  cached ??= buildDocument();
  return cached;
}

export async function buildDocument(): Promise<OpenAPIObject> {
  const moduleRef = await Test.createTestingModule({
    controllers: collectControllers(AppModule),
  })
    .useMocker(() => ({}))
    .compile();
  const app =
    moduleRef.createNestApplication<NestFastifyApplication>(fastifyAdapter());
  try {
    await configureApp(app);
    await app.init();
    return buildOpenApiDocument(app);
  } finally {
    await app.close();
  }
}

/** The operation of `method` on `route`; throws when the document has no such route. */
export function operationOf(
  document: OpenAPIObject,
  route: string,
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
): OperationObject {
  const operation = document.paths[route]?.[method];
  if (!operation) throw new Error(`The document has no ${method} ${route}`);
  return operation;
}

/** The query, path or header parameter `name` of an operation; throws when it is not documented. */
export function parameterOf(
  document: OpenAPIObject,
  target: {
    route: string;
    method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  },
  name: string,
): ParameterObject {
  const operation = operationOf(document, target.route, target.method);
  const found = ((operation.parameters ?? []) as ParameterObject[]).find(
    (parameter) => parameter.name === name,
  );
  if (!found)
    throw new Error(
      `${target.method} ${target.route} has no parameter ${name}`,
    );
  return found;
}
