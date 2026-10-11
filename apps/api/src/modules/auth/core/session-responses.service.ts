import { Injectable } from '@nestjs/common';
import type { Principal, SessionData, UserDocument } from '@libs/auth';
import { OrganizationCreationRights } from '../../organizations/creation/organization-creation-rights.service';
import {
  AdminCapabilitiesResponse,
  SessionResponse,
} from './dto/session.response';

const NO_SCOPE = { site: false, organizations: false };
const NO_CAPABILITIES: AdminCapabilitiesResponse = {
  organizations: false,
  problemCreation: NO_SCOPE,
  contestCreation: NO_SCOPE,
};

/** Builds the session body every sign-in route returns, with the object rights a permission list cannot tell. */
@Injectable()
export class SessionResponses {
  constructor(private readonly creation: OrganizationCreationRights) {}

  async of(
    user: UserDocument,
    principal: Principal,
    session: SessionData | null,
  ): Promise<SessionResponse> {
    // While the second factor is pending the response carries no user, so no capabilities are looked up.
    const pending = session !== null && !session.twoFaPassed;
    return SessionResponse.from(
      user,
      principal,
      session,
      pending ? NO_CAPABILITIES : await this.capabilitiesOf(principal),
    );
  }

  private async capabilitiesOf(
    principal: Principal,
  ): Promise<AdminCapabilitiesResponse> {
    const administers = await this.creation.administersAny(principal);
    const scopes = this.creation.scopes(principal, administers);
    return {
      organizations: administers,
      problemCreation: scopes.problems,
      contestCreation: scopes.contests,
    };
  }
}
