import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { operationOf } from './document';

/** The component name a property refers to, directly or through the `allOf` wrapper the plugin adds next to a description. */
function refName(node: unknown): string | undefined {
  const holder = node as
    { $ref?: string; allOf?: Array<{ $ref?: string }> } | undefined;
  return (holder?.$ref ?? holder?.allOf?.[0]?.$ref)?.split('/').pop();
}

function schemaNamed(document: OpenAPIObject, name: string): SchemaObject {
  const found = document.components?.schemas?.[name];
  if (!found) throw new Error(`The document has no schema ${name}`);
  return found as SchemaObject;
}

/** The SSE event names a stream route documents, frame by frame, flattened in document order. */
export function streamEventNames(
  document: OpenAPIObject,
  route: string,
): string[] {
  const response = operationOf(document, route, 'get').responses['200'] as {
    content?: Record<string, { schema?: SchemaObject }>;
  };
  const frames = response.content?.['text/event-stream']?.schema?.oneOf ?? [];
  return frames.flatMap((frame) => {
    const name = refName(frame) ?? '';
    const names = (
      schemaNamed(document, name).properties?.event as SchemaObject | undefined
    )?.enum;
    if (!names?.length) throw new Error(`${name} has no \`event\` literal`);
    return names.map(String);
  });
}

/** The member names of the `data` payload a frame class documents, sorted; a free-form payload has none. */
export function frameDataKeys(
  document: OpenAPIObject,
  frameName: string,
): string[] {
  const data = schemaNamed(document, frameName).properties?.data;
  const payloadName = refName(data);
  const payload = payloadName
    ? schemaNamed(document, payloadName)
    : (data as SchemaObject | undefined);
  return Object.keys(payload?.properties ?? {}).sort();
}
