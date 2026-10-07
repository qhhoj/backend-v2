import { Inject, Injectable } from '@nestjs/common';
import type { Principal, UserDocument } from '@libs/auth';
import { UsersRepository } from '@libs/auth';
import { AppError, ENV } from '@libs/common';
import type { Env } from '@libs/common';
import { canInteract, INTERACT_MIN_PROBLEM_COUNT } from '@libs/community';
import { uuidStr } from '@libs/database';
import type { User } from '@libs/database';
import { OrganizationAccess } from '../../organizations/core/organization-access';
import { OrganizationMembersRepository } from '../../organizations/core/organization-members.repository';
import { OrganizationPointsService } from '../../organizations/core/organization-points.service';
import { OrganizationsService } from '../../organizations/core/organizations.service';
import { OrganizationsRepository } from '../../organizations/core/organizations.repository';
import { OrganizationSummaryResponse } from '../../organizations/core/dto/organization.response';
import { LanguagesQuerier } from '../../problems/catalog/languages.querier';
import { renderField } from '../../problems/editing/problem-markup';
import type { UpdateProfileDto } from './dto/profile.dto';
import type { ProfileResponse } from './dto/profile.response';

const invalid = (field: string, message: string) =>
  new AppError('validation_failed', 400, message, { [field]: [message] });

@Injectable()
export class ProfileService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly users: UsersRepository,
    private readonly organizations: OrganizationsRepository,
    private readonly organizationsService: OrganizationsService,
    private readonly members: OrganizationMembersRepository,
    private readonly points: OrganizationPointsService,
    private readonly languages: LanguagesQuerier,
  ) {}

  async get(principal: Principal): Promise<ProfileResponse> {
    return this.respond(
      (await this.users.findById(principal.userId))!,
      principal,
    );
  }

  /** Legacy `edit_profile`/`ProfileForm`, without adding organizations (legacy let users self-join private ones here). */
  async update(
    principal: Principal,
    dto: UpdateProfileDto,
  ): Promise<ProfileResponse> {
    const user = (await this.users.findById(principal.userId))!;
    const { about, firstName, organizations, ...fields } = dto;
    const changes: Partial<User> = { ...fields };
    const trimmedFirstName = firstName?.trim();
    if (trimmedFirstName !== undefined && trimmedFirstName !== user.firstName) {
      this.refuseInOfficialContest(principal);
      changes.firstName = trimmedFirstName;
    }
    if (about !== undefined && about !== (user.about ?? '')) {
      this.refuseInOfficialContest(principal);
      if (!canInteract(user))
        throw new AppError(
          'forbidden',
          403,
          `Solve at least ${INTERACT_MIN_PROBLEM_COUNT} problems before editing your profile`,
        );
      Object.assign(changes, {
        about,
        aboutHtml: renderField(about, 'user', 'about'),
      });
    }
    if (dto.languageId !== undefined && !this.languages.has(dto.languageId))
      throw invalid('languageId', 'Unknown language.');
    if (
      dto.displayBadgeId &&
      !user.badges.map(uuidStr).includes(dto.displayBadgeId)
    )
      throw invalid('displayBadgeId', 'Not one of your badges.');
    if (organizations !== undefined)
      await this.reorder(
        principal,
        user.organizations.map(uuidStr),
        organizations,
      );
    if (Object.keys(changes).length)
      await this.users.update(principal.userId, changes);
    return this.respond(
      (await this.users.findById(principal.userId))!,
      principal,
    );
  }

  /** Legacy removed `about` and `first_name` from the form in official contest mode; superusers still edit. */
  private refuseInOfficialContest(principal: Principal): void {
    if (this.env.officialContestMode && !principal.isSuperuser)
      throw new AppError(
        'forbidden',
        403,
        'Profiles are locked during the official contest',
      );
  }

  private async reorder(
    principal: Principal,
    current: string[],
    next: string[],
  ): Promise<void> {
    if (next.some((id) => !current.includes(id)))
      throw invalid('organizations', 'Join organizations from their page.');
    const dropped = current.filter((id) => !next.includes(id));
    const administered = (await this.organizations.findByIds(dropped)).filter(
      (organization) =>
        OrganizationAccess.isAdmin(
          principal,
          OrganizationAccess.accessView(organization),
        ),
    );
    if (administered.length)
      throw new AppError(
        'conflict',
        409,
        'Admins cannot leave their organization',
      );
    if (
      !(await this.members.reorderIfUnchanged(principal.userId, current, next))
    )
      throw new AppError(
        'conflict',
        409,
        'Your memberships changed meanwhile; try again',
      );
    await this.points.refresh(dropped);
  }

  private async respond(
    user: UserDocument,
    principal: Principal,
  ): Promise<ProfileResponse> {
    const organizations = await this.organizationsService.listedFor(
      principal,
      user.organizations.map(uuidStr),
    );
    return {
      about: user.about ?? '',
      aboutHtml: user.aboutHtml,
      firstName: user.firstName,
      timezone: user.timezone,
      languageId: user.languageId && uuidStr(user.languageId),
      aceTheme: user.aceTheme,
      siteTheme: user.siteTheme,
      mathEngine: user.mathEngine,
      userScript: user.userScript,
      badges: user.badges.map(uuidStr),
      displayBadgeId: user.displayBadgeId && uuidStr(user.displayBadgeId),
      organizations: organizations.map((organization) => ({
        ...OrganizationSummaryResponse.from(organization),
        isOpen: organization.isOpen,
        isAdmin: OrganizationAccess.isAdmin(
          principal,
          OrganizationAccess.accessView(organization),
        ),
      })),
    };
  }
}
