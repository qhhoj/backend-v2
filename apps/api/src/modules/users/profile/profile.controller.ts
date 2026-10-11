import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { RefuseNullFieldsPipe } from '@libs/common';
import { NULLABLE_PROFILE_FIELDS, UpdateProfileDto } from './dto/profile.dto';
import type { ProfileResponse } from './dto/profile.response';
import { ProfileService } from './profile.service';

@ApiTags('Account')
@Controller('api/internal/profile')
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  /**
   * Get my profile
   *
   * @remarks
   * Signed-in callers only. Returns the editable profile of the caller: about text (source and rendered HTML), display name, time zone, default programming language, site theme, appearance, and the organizations the caller belongs to in display order.
   */
  @Get()
  get(@CurrentAuth() auth: AuthContext): Promise<ProfileResponse> {
    return this.profile.get(auth.principal);
  }

  /**
   * Update my profile
   *
   * @remarks
   * Signed-in callers only. Partial update: send only the fields to change and read the full profile back. `null` is accepted only for `appearance` (the site look); `appearance` replaces the stored look as a whole.
   * `organizations` may only reorder or shorten the current memberships (join from the organization page). Errors: 400 `unknown_language`, 400 `organizations_not_editable`; 403 `forbidden` when editing `about` or `firstName` during the official contest (superusers excepted) or when editing `about` while muted or before solving 5 problems (staff excepted); 409 `conflict` when leaving an organization the caller administers or when memberships changed meanwhile. The organization order is also frozen in official contest mode.
   */
  @Patch()
  update(
    @CurrentAuth() auth: AuthContext,
    @Body(new RefuseNullFieldsPipe(NULLABLE_PROFILE_FIELDS))
    body: UpdateProfileDto,
  ): Promise<ProfileResponse> {
    return this.profile.update(auth.principal, body);
  }
}
