import { INTEGRATION_SCOPES, uuidStr } from '@libs/database';
import type { IntegrationClient, IntegrationScope } from '@libs/database';
import { ApiProperty } from '@nestjs/swagger';

export class IntegrationClientActingUserResponse {
  /** User id. */
  id!: string;
  /** Login name. */
  username!: string;
}

export class IntegrationClientResponse {
  /** Client id. */
  id!: string;
  /** Label of the client. */
  name!: string;
  /** First characters of the key, to recognise it in this list. */
  keyPrefix!: string;
  /** What the client may do. */
  @ApiProperty({
    enum: INTEGRATION_SCOPES,
    enumName: 'IntegrationScope',
    isArray: true,
  })
  scopes!: IntegrationScope[];
  /** CIDR blocks the client may call from. */
  allowedCidrs!: string[];
  /** The user whose permissions bound the client. */
  actsAs!: IntegrationClientActingUserResponse;
  /** When the key was last used; null if never. */
  lastUsedAt!: Date | null;
  /** When the client was revoked; null while active. */
  revokedAt!: Date | null;
  /** The key stops working at this instant; null when it never expires. */
  expiresAt!: Date | null;
  /** When the client was created. */
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
