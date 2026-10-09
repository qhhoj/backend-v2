import { Injectable } from '@nestjs/common';
import type { Principal, UserDocument } from '@libs/auth';
import { UsersRepository } from '@libs/auth';
import { AppError, invalidField } from '@libs/common';
import {
  canInteract,
  INTERACT_MIN_PROBLEM_COUNT,
  officialModeLocks,
} from '@libs/community';
import { uuidStr } from '@libs/database';
import type { User } from '@libs/database';
import { SettingsService } from '@libs/settings';
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

/** Appearance is replaced whole; `null` clears it. Absent means unchanged. */
const appearanceChange = (
  appearance: UpdateProfileDto['appearance'],
): Partial<User> =>
  appearance === undefined
    ? {}
    : {
        appearance: appearance && {
          accent: appearance.accent,
          glass: appearance.glass,
          glow: appearance.glow,
        },
      };

@Injectable()
export class ProfileService {
  constructor(
    private readonly settings: SettingsService,
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
    const { about, firstName, organizations, appearance, ...fields } = dto;
    const changes: Partial<User> = {
      ...fields,
      ...appearanceChange(appearance),
      ...this.firstNameChange(principal, user, firstName),
      ...this.aboutChange(principal, user, about),
    };
    this.assertReferences(user, dto);
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

  /** Returns the trimmed name when it differs from the stored one. Throws in official contest mode when it differs. Pure otherwise. */
  private firstNameChange(
    principal: Principal,
    user: UserDocument,
    firstName: string | undefined,
  ): Partial<User> {
    const trimmed = firstName?.trim();
    if (trimmed === undefined || trimmed === user.firstName) return {};
    this.refuseInOfficialContest(principal);
    return { firstName: trimmed };
  }

  /** Returns `about` with its rendered HTML when it differs from the stored text. Throws in official contest mode, or below the interaction threshold, when it differs. Pure otherwise. */
  private aboutChange(
    principal: Principal,
    user: UserDocument,
    about: string | undefined,
  ): Partial<User> {
    if (about === undefined || about === (user.about ?? '')) return {};
    this.refuseInOfficialContest(principal);
    if (!canInteract(user))
      throw new AppError(
        'forbidden',
        403,
        `Solve at least ${INTERACT_MIN_PROBLEM_COUNT} problems before editing your profile`,
      );
    return { about, aboutHtml: renderField(about, 'user', 'about') };
  }

  /** Throws a 400 for an unknown language or a display badge the user does not hold. */
  private assertReferences(user: UserDocument, dto: UpdateProfileDto): void {
    if (dto.languageId !== undefined && !this.languages.has(dto.languageId))
      throw invalidField('languageId', 'Unknown language.', 'unknown_language');
    if (
      dto.displayBadgeId &&
      !user.badges.map(uuidStr).includes(dto.displayBadgeId)
    )
      throw invalidField(
        'displayBadgeId',
        'Not one of your badges.',
        'not_your_badge',
      );
  }

  /** Legacy removed `about` and `first_name` from the form in official contest mode; superusers still edit. */
  private refuseInOfficialContest(principal: Principal): void {
    if (officialModeLocks(this.settings, principal))
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
      throw invalidField(
        'organizations',
        'Join organizations from their page.',
        'organizations_not_editable',
      );
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
      appearance: user.appearance ?? null,
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
