/** A JSON object the server hands over untouched and the client passes to a library (WebAuthn options): its members belong to that library, so the document says "free-form" instead of listing them. */
export const OPAQUE_JSON_OBJECT = {
  type: 'object',
  additionalProperties: true,
} as const;
