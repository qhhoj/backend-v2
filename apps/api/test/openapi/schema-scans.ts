import type {
  OpenAPIObject,
  ParameterObject,
  SchemaObject,
} from '@nestjs/swagger';

const OBJECT_REF = '#/components/schemas/Object';
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

function operationsOf(document: OpenAPIObject) {
  return Object.entries(document.paths).flatMap(([route, item]) =>
    METHODS.flatMap((method) => {
      const operation = item[method];
      return operation
        ? [{ label: `${method.toUpperCase()} ${route}`, operation }]
        : [];
    }),
  );
}

const isBareObject = (schema: SchemaObject): boolean =>
  schema.type === 'object' &&
  !schema.additionalProperties &&
  Object.keys(schema.properties ?? {}).length === 0 &&
  !schema.allOf &&
  !schema.oneOf &&
  !schema.anyOf;

function looseParameters(document: OpenAPIObject): string[] {
  return operationsOf(document).flatMap(({ label, operation }) =>
    ((operation.parameters ?? []) as ParameterObject[])
      .filter((parameter) =>
        JSON.stringify(parameter.schema).includes(OBJECT_REF),
      )
      .map((parameter) => `${label} parameter ${parameter.name}`),
  );
}

function looseSchemas(document: OpenAPIObject): string[] {
  return Object.entries(document.components?.schemas ?? {}).flatMap(
    ([name, schema]) => {
      if (isBareObject(schema as SchemaObject))
        return [`schema ${name} is empty`];
      return Object.entries((schema as SchemaObject).properties ?? {})
        .filter(([, member]) => isBareObject(member as SchemaObject))
        .map(([property]) => `schema ${name}.${property} is a bare object`);
    },
  );
}

function looseData(document: OpenAPIObject): string[] {
  return operationsOf(document).flatMap(({ label, operation }) =>
    Object.entries(operation.responses ?? {})
      .filter(([status]) => status.startsWith('2'))
      .filter(([, response]) => {
        const schema = (
          response as { content?: Record<string, { schema?: SchemaObject }> }
        ).content?.['application/json']?.schema;
        const data = schema?.properties?.data as SchemaObject | undefined;
        return data !== undefined && isBareObject(data);
      })
      .map(([status]) => `${label} ${status} data is a bare object`),
  );
}

/**
 * Places where the document says "an object with nothing in it" although the code means something more: the swagger
 * plugin writes `Object` for a property it cannot type, and the generated frontend type then accepts anything.
 * An object that is meant to be free-form says so with `additionalProperties`.
 */
export const looseSites = (document: OpenAPIObject): string[] =>
  [
    ...looseParameters(document),
    ...looseSchemas(document),
    ...looseData(document),
  ].sort();

/**
 * Places where an enumeration with exactly `values` is spelled inline (on a property, an array's items or a parameter)
 * instead of by reference to its named component (`enumName`), so every use shares one generated type.
 */
export function inlineEnumSites(
  document: OpenAPIObject,
  values: readonly (string | number)[],
): string[] {
  const wanted = values.map(String).sort().join('|');
  const sites: string[] = [];
  const visit = (node: unknown, path: string): void => {
    if (node === null || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const isNamedEnum = /^\/components\/schemas\/[^/]+$/.test(path);
    const spelled = Array.isArray(record.enum)
      ? record.enum.map(String).sort().join('|')
      : undefined;
    if (!isNamedEnum && spelled === wanted) sites.push(path);
    for (const [key, child] of Object.entries(record))
      visit(child, `${path}/${key}`);
  };
  visit(document, '');
  return sites;
}
