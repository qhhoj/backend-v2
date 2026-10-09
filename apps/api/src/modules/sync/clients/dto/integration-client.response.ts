import { INTEGRATION_SCOPES, uuidStr } from '@libs/database';
import type { IntegrationClient, IntegrationScope } from '@libs/database';
import { ApiProperty } from '@nestjs/swagger';

export class IntegrationClientActingUserResponse {
  id!: string;
  username!: string;
}

export class IntegrationClientResponse {
  id!: string;
  name!: string;
  /** First characters of the key, to recognise it in this list. */
  keyPrefix!: string;
  @ApiProperty({
    enum: INTEGRATION_SCOPES,
    enumName: 'IntegrationScope',
    isArray: true,
  })
  scopes!: IntegrationScope[];
  allowedCidrs!: string[];
  /** The user whose permissions bound the client. */
  actsAs!: IntegrationClientActingUserResponse;
  lastUsedAt!: Date | null;
  revokedAt!: Date | null;
  /** The key stops working at this instant; null when it never expires. */
  expiresAt!: Date | null;
  createdAt!: Date;

  static from(
    client: IntegrationClient,
    actsAsUsername: string,
  ): IntegrationClientResponse {
    return {
      id: uuidStr(client._id),
      name: client.name,
      keyPrefix: client.keyPrefix,
      scopes: [...client.scopes],
      allowedCidrs: [...client.allowedCidrs],
      actsAs: { id: uuidStr(client.actsAs), username: actsAsUsername },
      lastUsedAt: client.lastUsedAt,
      revokedAt: client.revokedAt,
      expiresAt: client.expiresAt,
      createdAt: client.createdAt,
    };
  }
}

/** The only response that carries the key. */
export class CreatedIntegrationClientResponse extends IntegrationClientResponse {
  /** Shown once; only its hash is stored. */
  key!: string;
}
