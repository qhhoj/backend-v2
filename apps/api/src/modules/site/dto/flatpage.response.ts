export class FlatpageResponse {
  /** Canonical: leading slash, no trailing slash. */
  url!: string;
  title!: string;
  /** Rendered and sanitised by whoever stored the page; the SPA inserts it as is. */
  contentHtml!: string;
}
