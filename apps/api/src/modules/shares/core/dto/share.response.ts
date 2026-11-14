import { ApiProperty } from '@nestjs/swagger';
import { SHARE_KINDS, uuidStr } from '@libs/database';
import type {
  Share,
  ShareKind,
  ShareLanguage,
  ShareTakedown,
} from '@libs/database';
import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';
import type { UserDocument } from '@libs/auth';

export class ShareLanguageResponse {
  /** Language key at share time. */
  key!: string;
  /** Language name at share time. */
  name!: string;
  /** File extension at share time. */
  extension!: string;

  static from(language: ShareLanguage): ShareLanguageResponse {
    return {
      key: language.key,
      name: language.name,
      extension: language.extension,
    };
  }
}

export class ShareTakedownResponse {
  /** When staff took it down. */
  at!: Date;
  /** Why, as staff wrote it. */
  reason!: string;

  static from(takedown: ShareTakedown | null): ShareTakedownResponse | null {
    return takedown ? { at: takedown.at, reason: takedown.reason } : null;
  }
}

/** A share as its owner manages it (create, edit, My shares). */
export class ShareSummaryResponse {
  /** The code in `/c/<code>`. */
  code!: string;
  /** `submission`: a frozen copy of a submission; `paste`: pasted code. */
  @ApiProperty({ enum: SHARE_KINDS, enumName: 'ShareKind' })
  kind!: ShareKind;
  /** The owner's title; may be empty. */
  title!: string;
  /** The language at share time. */
  language!: ShareLanguageResponse;
  /** The copied submission; null for a paste. */
  submissionId!: string | null;
  /** When the link stops working; null if it never expires. */
  expiresAt!: Date | null;
  /** Set while staff keep it taken down. */
  takenDown!: ShareTakedownResponse | null;
  /** When the share was made. */
  createdAt!: Date;

  static from(share: Share): ShareSummaryResponse {
    return {
      code: share.code,
      kind: share.kind,
      title: share.title,
      language: ShareLanguageResponse.from(share.language),
      submissionId: share.copy ? uuidStr(share.copy.submissionId) : null,
      expiresAt: share.expiresAt,
      takenDown: ShareTakedownResponse.from(share.takenDown),
      createdAt: share.createdAt,
    };
  }
}

/** A row of the share list, with whose it is (staff list every user's). */
export class ShareListItemResponse extends ShareSummaryResponse {
  /** The owner; null when the account is gone. */
  author!: UserSummaryResponse | null;

  static withAuthor(
    share: Share,
    author: UserDocument | undefined,
  ): ShareListItemResponse {
    return {
      ...ShareSummaryResponse.from(share),
      author: author ? UserSummaryResponse.from(author) : null,
    };
  }
}
