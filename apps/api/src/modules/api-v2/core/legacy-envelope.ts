export const API_V2_PAGE_SIZE = 1000;
export const LEGACY_MESSAGES: Record<number, string> = {
  400: 'invalid filter value type',
  401: 'login required',
  403: 'permission denied',
  404: 'page/object not found',
};

/** Django `isoformat()` of an aware UTC datetime. */
export const isoformat = (date: Date) =>
  date.toISOString().replace('Z', '+00:00');

const header = (method: string) => ({
  api_version: '2.0',
  method: method.toLowerCase(),
  fetched: isoformat(new Date()),
});

export const legacyEnvelope = (method: string, data: unknown) => ({
  ...header(method),
  data,
});
export const legacyError = (
  method: string,
  status: number,
  message: string,
) => ({ ...header(method), error: { code: status, message } });

export interface LegacyPage<Item> {
  current_object_count: number;
  objects_per_page: number;
  page_index: number;
  has_more: boolean;
  objects: Item[];
  total_objects: number;
  total_pages: number;
}

export const legacyTotalPages = (total: number) =>
  Math.max(1, Math.ceil(total / API_V2_PAGE_SIZE));

export function legacyPage<Item>(
  objects: Item[],
  page: number,
  total: number,
): LegacyPage<Item> {
  const totalPages = legacyTotalPages(total);
  return {
    current_object_count: objects.length,
    objects_per_page: API_V2_PAGE_SIZE,
    page_index: page,
    has_more: page < totalPages,
    objects,
    total_objects: total,
    total_pages: totalPages,
  };
}

export type LegacyInfinitePage<Item> = Omit<
  LegacyPage<Item>,
  'total_objects' | 'total_pages'
>;

/** Legacy infinite pagination (no basic filter): no totals, `has_more` from one extra row, so the whole collection is never counted. */
export const legacyInfinitePage = <Item>(
  objects: Item[],
  page: number,
  hasMore: boolean,
): LegacyInfinitePage<Item> => ({
  current_object_count: objects.length,
  objects_per_page: API_V2_PAGE_SIZE,
  page_index: page,
  has_more: hasMore,
  objects,
});
