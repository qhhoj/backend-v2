import type { ShortLink } from '@libs/database';

export class ShortLinkResponse {
  code!: string;
  path!: string;
  /** Made for anyone by path (idempotent) rather than chosen by staff. */
  isAuto!: boolean;
  hits!: number;
  lastHitAt!: Date | null;
  expiresAt!: Date | null;
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
