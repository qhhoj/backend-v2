import { compareEnumValues } from '@libs/common';
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

const enumKey = (values: readonly (string | number)[]): string =>
  values.map(String).sort().join('|');

/** Names of the component schemas that are an enumeration of exactly `values`: one name means every site shares one generated type. */
export function namedEnumsWith(
  document: OpenAPIObject,
  values: readonly (string | number)[],
): string[] {
  const wanted = enumKey(values);
  return Object.entries(document.components?.schemas ?? {})
    .filter(([, schema]) => {
      const members = (schema as SchemaObject).enum;
      return members !== undefined && enumKey(members) === wanted;
    })
    .map(([name]) => name)
    .sort();
}

/** Groups of component enumerations that list the same values under different names (a renamed `enumName` at one site). */
export function duplicateEnums(document: OpenAPIObject): string[][] {
  const byValues = new Map<string, string[]>();
  for (const [name, schema] of Object.entries(
    document.components?.schemas ?? {},
  )) {
    const members = (schema as SchemaObject).enum;
    if (members === undefined) continue;
    byValues.set(enumKey(members), [
      ...(byValues.get(enumKey(members)) ?? []),
      name,
    ]);
  }
  return [...byValues.values()].filter((names) => names.length > 1);
}

/** JSON pointers of every `enum` list in `document` that is not in canonical order (numbers numerically, strings by code point). */
export function unsortedEnumSites(document: unknown): string[] {
  const sites: string[] = [];
  const visit = (node: unknown, path: string): void => {
    if (node === null || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      const here = `${path}/${key}`;
      if (key === 'enum' && Array.isArray(child)) {
        const sorted = [...(child as unknown[])].sort(compareEnumValues);
        if (JSON.stringify(sorted) !== JSON.stringify(child)) sites.push(here);
      } else visit(child, here);
    }
  };
  visit(document, '');
  return sites;
}

/**
 * Parameters and properties that have a `default` yet are `required`: the generated client then forces callers to send
 * a value the server would fill in anyway. A defaulted member is optional by definition.
 */
export function defaultedRequiredSites(document: OpenAPIObject): string[] {
  const parameters = operationsOf(document).flatMap(({ label, operation }) =>
    ((operation.parameters ?? []) as ParameterObject[])
      .filter(
        (parameter) =>
          parameter.required &&
          (parameter.schema as SchemaObject | undefined)?.default !== undefined,
      )
      .map((parameter) => `${label} parameter ${parameter.name}`),
  );
  const properties = Object.entries(document.components?.schemas ?? {}).flatMap(
    ([name, schema]) => {
      const { properties = {}, required = [] } = schema as SchemaObject;
      return required
        .filter(
          (property) =>
            (properties[property] as SchemaObject | undefined)?.default !==
            undefined,
        )
        .map((property) => `schema ${name}.${property}`);
    },
  );
  return [...parameters, ...properties].sort();
}
