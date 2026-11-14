import { SHARE_CODE_LENGTH } from '@libs/database';
import { randomShortCode } from '../../short-links/short-code';

export interface ShareCodeTuning {
  /** Where new share codes come from; specs queue codes to force collisions. */
  shareCodes: { next(): string };
}

export const SHARE_CODE_TUNING: ShareCodeTuning = {
  shareCodes: { next: () => randomShortCode({ length: SHARE_CODE_LENGTH }) },
};
