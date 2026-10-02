import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoCBOR } from '@simplewebauthn/server/helpers';

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_DATA = 0x40;

/** Software authenticator: ES256 key, `none` attestation, counter that can be pinned for clone tests. */
export class FakeAuthenticator {
  readonly credentialId = randomBytes(16);
  private readonly keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  private signCount = 0;

  constructor(
    private readonly rpId: string,
    private readonly origin: string,
  ) {}

  get id(): string {
    return this.credentialId.toString('base64url');
  }

  /** The next response reports exactly this counter. */
  setSignCount(count: number): void {
    this.signCount = count - 1;
  }

  register(challenge: string): RegistrationResponseJSON {
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length);
    const attestedData = Buffer.concat([
      Buffer.alloc(16),
      idLength,
      this.credentialId,
      this.coseKey(),
    ]);
    const attestationObject = isoCBOR.encode(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        [
          'authData',
          this.authenticatorData(
            FLAG_USER_PRESENT | FLAG_USER_VERIFIED | FLAG_ATTESTED_DATA,
            attestedData,
          ),
        ],
      ]) as never,
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: this.clientData('webauthn.create', challenge).toString(
          'base64url',
        ),
        attestationObject: Buffer.from(attestationObject).toString('base64url'),
        transports: ['usb'],
      },
    };
  }

  authenticate(challenge: string): AuthenticationResponseJSON {
    const authenticatorData = this.authenticatorData(
      FLAG_USER_PRESENT | FLAG_USER_VERIFIED,
    );
    const clientData = this.clientData('webauthn.get', challenge);
    const signature = sign(
      'sha256',
      Buffer.concat([
        authenticatorData,
        createHash('sha256').update(clientData).digest(),
      ]),
      this.keys.privateKey,
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: clientData.toString('base64url'),
        authenticatorData: authenticatorData.toString('base64url'),
        signature: signature.toString('base64url'),
      },
    };
  }

  private coseKey(): Buffer {
    const jwk = this.keys.publicKey.export({ format: 'jwk' });
    return Buffer.from(
      isoCBOR.encode(
        new Map<number, number | Uint8Array>([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, Buffer.from(jwk.x!, 'base64url')],
          [-3, Buffer.from(jwk.y!, 'base64url')],
        ]) as never,
      ),
    );
  }

  private authenticatorData(
    flags: number,
    attestedData = Buffer.alloc(0),
  ): Buffer {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(++this.signCount);
    return Buffer.concat([
      createHash('sha256').update(this.rpId).digest(),
      Buffer.from([flags]),
      counter,
      attestedData,
    ]);
  }

  private clientData(type: string, challenge: string): Buffer {
    return Buffer.from(
      JSON.stringify({
        type,
        challenge,
        origin: this.origin,
        crossOrigin: false,
      }),
    );
  }
}
