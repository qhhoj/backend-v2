import { ApiProperty } from '@nestjs/swagger';
import { uuidStr } from '@libs/database';
import type { NavigationItem } from '@libs/database';

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

  /** `item` may come straight from a lean query: ids are BSON UUIDs there. */
  static from(item: NavigationItem): NavigationItemResponse {
    return {
      id: uuidStr(item._id),
      key: item.key,
      label: item.label,
      path: item.path,
      regex: item.regex,
      hidden: item.hidden,
      order: item.order,
      parentId: item.parentId ? uuidStr(item.parentId) : null,
    };
  }
}

export class SiteResponse {
  navigation!: NavigationItemResponse[];
  /** Legacy misc config: free-form key/value text served to everyone, so it must never hold secrets. */
  config!: Record<string, string>;
  /** Official contest mode is on right now (the flag and its end time). The response is cached `private, max-age=60`, so the shell may show the banner up to a minute after the mode ends. */
  officialMode!: boolean;
  /** The ISO 8601 UTC instant the mode switches itself off, or `null` when the mode is off or has no end time. Same cache as `officialMode`. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  officialModeEndsAt!: string | null;
}
