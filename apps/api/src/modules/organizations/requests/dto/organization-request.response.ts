import { ApiProperty } from '@nestjs/swagger';
import { ORGANIZATION_REQUEST_STATES, uuidStr } from '@libs/database';
import type {
  OrganizationRequest,
  OrganizationRequestState,
} from '@libs/database';

export class OrganizationRequestResponse {
  id!: string;
  /** Slug of the organization asked to join. */
  organizationSlug!: string;
  /** Id of the requester. */
  userId!: string;
  /** Username of the requester. */
  username!: string;
  /** P pending, A approved or R rejected. */
  @ApiProperty({
    enum: ORGANIZATION_REQUEST_STATES,
    enumName: 'OrganizationRequestState',
  })
  state!: OrganizationRequestState;
  /** The reason the requester gave. */
  reason!: string;
  /** When the request was filed, ISO 8601. */
  createdAt!: Date;
  /** Id of the admin who decided; null while pending. */
  decidedBy!: string | null;
  /** When the request was decided, ISO 8601; null while pending. */
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
