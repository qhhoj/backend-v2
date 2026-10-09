/** Meta of a newest-first list paged by cursor: pass `nextBefore` as `before` for the next page (null on the last page). */
export class CursorPageMetaResponse {
  pageSize!: number;
  nextBefore!: string | null;
}
