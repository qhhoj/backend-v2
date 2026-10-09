/** Colour token keys of contest tags and organization problem tags, defined in every theme file by the frontend; the API never stores a hex. */
export const TAG_COLORS = [
  'tag-1',
  'tag-2',
  'tag-3',
  'tag-4',
  'tag-5',
  'tag-6',
  'tag-7',
  'tag-8',
] as const;
export type TagColor = (typeof TAG_COLORS)[number];
