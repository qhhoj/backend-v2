/** Schema of a setting's value: any JSON value, shaped by the setting's definition. */
export const ANY_JSON_VALUE = {
  type: 'object',
  additionalProperties: true,
  nullable: true,
  description: 'Any JSON value; its shape is the setting definition.',
} as const;
