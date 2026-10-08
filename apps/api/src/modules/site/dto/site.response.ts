export class NavigationItemResponse {
  id!: string;
  key!: string;
  label!: string;
  path!: string;
  /** A JavaScript regular expression for the SPA to test against the current path. */
  regex!: string;
  hidden!: boolean;
  order!: number;
  parentId!: string | null;
}

export class SiteResponse {
  navigation!: NavigationItemResponse[];
  /** Legacy misc config: free-form key/value text served to everyone, so it must never hold secrets. */
  config!: Record<string, string>;
}
