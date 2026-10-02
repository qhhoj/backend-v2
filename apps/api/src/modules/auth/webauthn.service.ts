import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from '@simplewebauthn/server';
import { SessionService, UsersRepository } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { AppError, ENV } from '@libs/common';
import type { Env } from '@libs/common';
import { newId } from '@libs/database';
import { SecondFactorService } from './second-factor.service';

const RP_NAME = 'QHHOJ';
const USER_HANDLE_BYTES = 32;
const DUPLICATE_KEY_ERROR = 11000;

const failed = (message = 'WebAuthn verification failed') =>
  new AppError('webauthn_failed', 400, message);

@Injectable()
export class WebauthnService {
  private readonly rpID: string;
  private readonly origin: string;

  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: SessionService,
    private readonly secondFactor: SecondFactorService,
    @Inject(ENV) env: Env,
  ) {
    const site = new URL(env.siteUrl);
    this.rpID = site.hostname;
    this.origin = site.origin;
  }

  // @SessionOnly() guarantees a session, so `auth.sessionId` is set on every method here.
  async registrationOptions(
    auth: AuthContext,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: this.rpID,
      userName: auth.user.username,
      userID: await this.userHandle(auth.user),
      excludeCredentials: [...auth.user.webauthnCredentials].map(
        (credential) => ({ id: credential.credId }),
      ),
      authenticatorSelection: { userVerification: 'preferred' },
    });
    await this.sessions.update(auth.sessionId!, {
      webauthnChallenge: options.challenge,
    });
    return options;
  }

  async register(
    auth: AuthContext,
    name: string,
    response: Record<string, unknown>,
  ): Promise<{ id: string; name: string }> {
    // Atomic read+clear: a challenge authorizes exactly one verification.
    const challenge = await this.sessions.consume(
      auth.sessionId!,
      'webauthnChallenge',
    );
    if (!challenge) throw failed('No pending WebAuthn challenge');
    let credentialInfo: WebAuthnCredential;
    try {
      const { verified, registrationInfo } = await verifyRegistrationResponse({
        response: response as unknown as RegistrationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        requireUserVerification: false,
      });
      if (!verified || !registrationInfo) throw failed();
      credentialInfo = registrationInfo.credential;
    } catch {
      throw failed();
    }
    const id = newId();
    try {
      await this.users.addWebauthnCredential(auth.user._id, {
        _id: id,
        name,
        credId: credentialInfo.id,
        publicKey: Buffer.from(credentialInfo.publicKey).toString('base64url'),
        counter: credentialInfo.counter,
      });
    } catch (error) {
      // credId is unique across users: registering an already-known authenticator.
      if ((error as { code?: number }).code === DUPLICATE_KEY_ERROR)
        throw failed('WebAuthn registration failed');
      throw error;
    }
    return { id, name };
  }

  async loginOptions(
    auth: AuthContext,
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const credentials = [...auth.user.webauthnCredentials];
    if (!credentials.length)
      throw new AppError(
        'webauthn_not_enabled',
        400,
        'WebAuthn is not enabled',
      );
    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      allowCredentials: credentials.map((credential) => ({
        id: credential.credId,
      })),
      userVerification: 'preferred',
    });
    await this.sessions.update(auth.sessionId!, {
      webauthnChallenge: options.challenge,
    });
    return options;
  }

  async login(
    auth: AuthContext,
    response: Record<string, unknown>,
  ): Promise<void> {
    if (auth.session?.twoFaPassed) return;
    const release = await this.secondFactor.reserveAttempt(auth.user._id);
    const challenge = await this.sessions.consume(
      auth.sessionId!,
      'webauthnChallenge',
    );
    if (!challenge) throw failed('No pending WebAuthn challenge');
    const credential = [...auth.user.webauthnCredentials].find(
      (candidate) => candidate.credId === response.id,
    );
    if (!credential) throw failed('Unknown credential');
    let newCounter: number;
    try {
      const { verified, authenticationInfo } =
        await verifyAuthenticationResponse({
          response: response as unknown as AuthenticationResponseJSON,
          expectedChallenge: challenge,
          expectedOrigin: this.origin,
          expectedRPID: this.rpID,
          requireUserVerification: false,
          credential: {
            id: credential.credId,
            publicKey: new Uint8Array(
              Buffer.from(credential.publicKey, 'base64url'),
            ),
            counter: credential.counter,
          },
        });
      if (!verified) throw failed();
      newCounter = authenticationInfo.newCounter;
    } catch {
      throw failed();
    }
    // The library rejects a non-increasing counter; the CAS closes the race between two concurrent assertions.
    if (newCounter > credential.counter) {
      if (
        !(await this.users.updateWebauthnCounter(
          auth.user._id,
          credential.credId,
          newCounter,
        ))
      )
        throw failed('Sign counter did not increase');
    } else if (
      // Defensive: the library already rejects this; kept so the CAS rule does not depend on it.
      newCounter !== 0 ||
      credential.counter !== 0
    )
      throw failed('Sign counter did not increase');
    await this.secondFactor.complete(auth);
    await release();
  }

  async remove(auth: AuthContext, credentialId: string): Promise<void> {
    if (
      !(await this.users.removeWebauthnCredential(auth.user._id, credentialId))
    )
      throw new AppError('not_found', 404, 'Credential not found');
  }

  /** Stable per-user handle; created once with a CAS so concurrent first registrations agree. */
  private async userHandle(
    user: AuthContext['user'],
  ): Promise<Uint8Array<ArrayBuffer>> {
    if (user.webauthnUserHandle) return new Uint8Array(user.webauthnUserHandle);
    const handle = randomBytes(USER_HANDLE_BYTES);
    if (await this.users.setWebauthnUserHandle(user._id, handle))
      return new Uint8Array(handle);
    // Lost the race: another request stored the handle first.
    const stored = (await this.users.findById(user._id))?.webauthnUserHandle;
    if (!stored) throw new Error('WebAuthn user handle was not persisted');
    return new Uint8Array(stored);
  }
}
