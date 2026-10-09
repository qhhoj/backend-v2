/** Query strings arrive as `string | string[]`; repeatable params become arrays. */
export const toArray = ({ value }: { value: unknown }): unknown[] =>
  Array.isArray(value) ? value : [value];
