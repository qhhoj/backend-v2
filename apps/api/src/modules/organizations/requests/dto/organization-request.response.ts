import { ApiProperty } from '@nestjs/swagger';
import { ORGANIZATION_REQUEST_STATES, uuidStr } from '@libs/database';
import type {
  OrganizationRequest,
  OrganizationRequestState,
} from '@libs/database';

export class OrganizationRequestResponse {
  id!: string;
  organizationSlug!: string;
  userId!: string;
  username!: string;
  @ApiProperty({
    enum: ORGANIZATION_REQUEST_STATES,
    enumName: 'OrganizationRequestState',
  })
  state!: OrganizationRequestState;
  reason!: string;
  createdAt!: Date;
  decidedBy!: string | null;
  decidedAt!: Date | null;

  static from(
    request: OrganizationRequest,
    organizationSlug: string,
    username: string,
  ): OrganizationRequestResponse {
    return {
      id: uuidStr(request._id),
      organizationSlug,
      userId: uuidStr(request.user),
      username,
      state: request.state,
      reason: request.reason,
      createdAt: request.createdAt,
      decidedBy: request.decidedBy && uuidStr(request.decidedBy),
      decidedAt: request.decidedAt,
    };
  }
}
