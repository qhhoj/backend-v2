import { Injectable } from '@nestjs/common';
import type { Principal, SessionData, UserDocument } from '@libs/auth';
import { OrganizationsService } from '../../organizations/core/organizations.service';
import {
  AdminCapabilitiesResponse,
  SessionResponse,
} from './dto/session.response';

/** Builds the session body every sign-in route returns, with the object rights a permission list cannot tell. */
@Injectable()
export class SessionResponses {
  constructor(private readonly organizations: OrganizationsService) {}

  async of(
    user: UserDocument,
    principal: Principal,
    session: SessionData | null,
  ): Promise<SessionResponse> {
    return SessionResponse.from(
      user,
      principal,
      session,
      await this.capabilitiesOf(principal),
    );
  }

  private async capabilitiesOf(
    principal: Principal,
  ): Promise<AdminCapabilitiesResponse> {
    return {
      organizations: await this.organizations.administersAny(principal),
    };
  }
}
