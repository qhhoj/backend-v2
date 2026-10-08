import type { WebauthnCredential } from '@libs/database';

/** A registered security key as the settings page shows it; the credential id and public key never leave the server. */
export class WebauthnCredentialResponse {
  id!: string;
  name!: string;

  static from(credential: WebauthnCredential): WebauthnCredentialResponse {
    return { id: credential._id, name: credential.name };
  }
}
