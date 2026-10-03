/** Query strings arrive as `string | string[]`; repeatable params become arrays. */
export const toArray = ({ value }: { value: unknown }): unknown[] =>
  Array.isArray(value) ? value : [value];
/** `true|1` / `false|0`; anything else is left for `@IsBoolean` to reject. */
export const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' || value === '1'
    ? true
    : value === 'false' || value === '0'
      ? false
      : value;
