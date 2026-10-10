import type { ShortLink } from '@libs/database';

export class ShortLinkResponse {
  /** The code in `/s/<code>`. */
  code!: string;
  /** Site path the link redirects to. */
  path!: string;
  /** Made for anyone by path (idempotent) rather than chosen by staff. */
  isAuto!: boolean;
  /** Number of counted visits. */
  hits!: number;
  /** When the link was last visited; null if never. */
  lastHitAt!: Date | null;
  /** When the link stops working; null if it never expires. */
  expiresAt!: Date | null;
  /** When the link was created. */
  createdAt!: Date;

  static from(link: ShortLink): ShortLinkResponse {
    return {
      code: link.code,
      path: link.path,
      isAuto: link.isAuto,
      hits: link.hits,
      lastHitAt: link.lastHitAt,
      expiresAt: link.expiresAt,
      createdAt: link.createdAt,
    };
  }
}
