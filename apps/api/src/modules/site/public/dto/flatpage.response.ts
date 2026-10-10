export class FlatpageResponse {
  /** Canonical: leading slash, no trailing slash. */
  url!: string;
  /** Page title. */
  title!: string;
  /** Rendered and sanitised by whoever stored the page; the SPA inserts it as is. */
  contentHtml!: string;
  /** Members-only page: the reader is signed in (a signed-out reader gets 401). */
  registrationRequired!: boolean;
}
