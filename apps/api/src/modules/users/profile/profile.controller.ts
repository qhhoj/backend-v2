import { Body, Controller, Get, Patch } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { RefuseNullFieldsPipe } from '@libs/common';
import { NULLABLE_PROFILE_FIELDS, UpdateProfileDto } from './dto/profile.dto';
import type { ProfileResponse } from './dto/profile.response';
import { ProfileService } from './profile.service';

@Controller('api/internal/profile')
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  get(@CurrentAuth() auth: AuthContext): Promise<ProfileResponse> {
    return this.profile.get(auth.principal);
  }

  @Patch()
  update(
    @CurrentAuth() auth: AuthContext,
    @Body(new RefuseNullFieldsPipe(NULLABLE_PROFILE_FIELDS))
    body: UpdateProfileDto,
  ): Promise<ProfileResponse> {
    return this.profile.update(auth.principal, body);
  }
}
