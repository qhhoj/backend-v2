import { Injectable } from '@nestjs/common';
import { RateLimitService } from '@libs/common';
import { uuidStr } from '@libs/database';
import {
  USER_SUGGEST_LIMIT,
  USER_SUGGEST_WINDOW_SECONDS,
} from '../core/rate-limits';
import type { UserSuggestionResponse } from './dto/user-suggestion.response';
import { UserSuggestionsRepository } from './user-suggestions.repository';

/** How many users one suggestion list offers. */
const SUGGESTION_COUNT = 10;

@Injectable()
export class UserSuggestionsService {
  constructor(
    private readonly repository: UserSuggestionsRepository,
    private readonly rateLimit: RateLimitService,
  ) {}

  /** Every request counts against the caller's budget, found or not, so a prefix walk stays slow. */
  async suggest(
    userId: string,
    prefix: string,
  ): Promise<UserSuggestionResponse[]> {
    await this.rateLimit.reserve(
      [`user-suggest:user:${userId}`],
      USER_SUGGEST_LIMIT,
      USER_SUGGEST_WINDOW_SECONDS,
    );
    const rows = await this.repository.byPrefix(prefix, SUGGESTION_COUNT);
    return rows.map((row) => ({
      id: uuidStr(row._id),
      username: row.username,
    }));
  }
}
