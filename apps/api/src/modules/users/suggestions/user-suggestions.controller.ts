import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Query } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { UserSuggestionQueryDto } from './dto/user-suggestion.dto';
import { UserSuggestionResponse } from './dto/user-suggestion.response';
import { UserSuggestionsService } from './user-suggestions.service';

@ApiTags('Users')
@Controller('api/internal/user-suggestions')
export class UserSuggestionsController {
  constructor(private readonly suggestions: UserSuggestionsService) {}

  /**
   * Suggest users by username prefix
   *
   * @remarks
   * Signed-in callers only (the admin username pickers). Returns up to 10 users whose username starts with `prefix`, ignoring case, in username order, with only their id and username. Banned and unlisted users are included, as their profile pages are. 60 requests per user per minute, then 429 `rate_limited` with `Retry-After`.
   */
  @Get()
  suggest(
    @CurrentAuth() auth: AuthContext,
    @Query() { prefix }: UserSuggestionQueryDto,
  ): Promise<UserSuggestionResponse[]> {
    return this.suggestions.suggest(auth.principal.userId, prefix);
  }
}
