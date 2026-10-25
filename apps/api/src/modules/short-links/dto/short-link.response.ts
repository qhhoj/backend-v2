import type { ShortLink } from '@libs/database';

/** What a create answers: the link without its visit stats, since the path's automatic link may be someone else's (owners and staff read the stats from the list). */
export class CreatedShortLinkResponse {
  /** The code in `/s/<code>`. */
  code!: string;
  /** Site path the link redirects to. */
  path!: string;
  /** Made for anyone by path (idempotent) rather than chosen by staff. */
  isAuto!: boolean;
  /** When the link stops working; null if it never expires. */
  expiresAt!: Date | null;

  static from(link: ShortLink): CreatedShortLinkResponse {
    return {
      code: link.code,
      path: link.path,
      isAuto: link.isAuto,
      expiresAt: link.expiresAt,
    };
  }
}

export class ShortLinkResponse extends CreatedShortLinkResponse {
  /** Number of counted visits. */
  hits!: number;
  /** When the link was last visited; null if never. */
  lastHitAt!: Date | null;
  /** When the link was created. */
  createdAt!: Date;

  static from(link: ShortLink): ShortLinkResponse {
    return {
      ...CreatedShortLinkResponse.from(link),
      hits: link.hits,
      lastHitAt: link.lastHitAt,
      createdAt: link.createdAt,
    };
  }
}
