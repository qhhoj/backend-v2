/** Meta of a list that does not count its rows: the client only learns whether another page follows. */
export class HasMorePageMetaResponse {
  page!: number;
  pageSize!: number;
  hasMore!: boolean;
}
