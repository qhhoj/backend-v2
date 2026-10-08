import type { OpenAPIObject } from '@nestjs/swagger';

/** Marks a schema property as "any JSON value"; `untypeAnyJson` strips the `type` Nest derives from `unknown`. */
export const ANY_JSON_MARKER = 'x-any-json';

/** Schema of a setting's value: any JSON value, shaped by the setting's definition. */
export const ANY_JSON_VALUE = {
  nullable: true,
  description: 'Any JSON value; its shape is the setting definition.',
  [ANY_JSON_MARKER]: true,
} as const;

/** Nest types an `unknown` property as `object`; OAS 3.0 spells "any value" as a schema without `type`. */
export function untypeAnyJson(document: OpenAPIObject): void {
  for (const schema of Object.values(document.components?.schemas ?? {})) {
    if ('$ref' in schema) continue;
    for (const property of Object.values(schema.properties ?? {})) {
      if (ANY_JSON_MARKER in property) {
        delete (property as Record<string, unknown>).type;
        delete (property as Record<string, unknown>)[ANY_JSON_MARKER];
      }
    }
  }
}
