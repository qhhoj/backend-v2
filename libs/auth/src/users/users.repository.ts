import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  CI,
  isUuid,
  SocialAuth,
  User,
  uuidStr,
  WebauthnCredential,
} from '@libs/database';
import { AppError } from '@libs/common';
import { HydratedDocument, Model } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

/** An abandoned signup: never activated, never logged in, not banned, older than `cutoff`. */
export const stalePendingFilter = (cutoff: Date) => ({
  isActive: false,
  banReason: null,
  lastLogin: null,
  dateJoined: { $lt: cutoff },
});

@Injectable()
export class UsersRepository {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  async findById(id: string): Promise<UserDocument | null> {
    return isUuid(id) ? this.users.findById(id).exec() : null;
  }

  /** The signed-in user's row; a session outliving its user answers 401. */
  async signedIn(principal: { userId: string }): Promise<UserDocument> {
    const user = await this.findById(principal.userId);
    if (!user) throw new AppError('unauthorized', 401, 'Login required');
    return user;
  }

  findByIds(ids: string[]): Promise<UserDocument[]> {
    return ids.length
      ? this.users
          .find({ _id: { $in: ids } }, { username: 1, rating: 1 })
          .exec()
      : Promise.resolve([]);
  }

  /** `fields` is an optional Mongo projection, for callers that read few fields. */
  findByUsername(
    username: string,
    fields?: Record<string, 1>,
  ): Promise<UserDocument | null> {
    return this.users.findOne({ username }, fields).collation(CI).exec();
  }

  findByEmail(email: string): Promise<UserDocument | null> {
    return this.users.findOne({ email }).collation(CI).exec();
  }

  findBySocial(provider: string, uid: string): Promise<UserDocument | null> {
    // $elemMatch alone cannot use the partial index; the dotted $exists makes it eligible.
    return this.users
      .findOne({
        socialAuth: { $elemMatch: { provider, uid } },
        'socialAuth.uid': { $exists: true },
      })
      .exec();
  }

  /** False when the user already has a link for this provider (one account per provider). */
  async linkSocial(userId: string, link: SocialAuth): Promise<boolean> {
    const { matchedCount } = await this.users
      .updateOne(
        {
          _id: userId,
          socialAuth: { $not: { $elemMatch: { provider: link.provider } } },
        },
        { $push: { socialAuth: link } },
      )
      .exec();
    return matchedCount === 1;
  }

  async findActiveByEmail(email: string): Promise<UserDocument[]> {
    if (!email) return [];
    return this.users.find({ email, isActive: true }).collation(CI).exec();
  }

  create(fields: Partial<User>): Promise<UserDocument> {
    return this.users.create(fields);
  }

  async delete(id: string): Promise<void> {
    await this.users.deleteOne({ _id: id }).exec();
  }

  /** Conditional delete of an abandoned signup (see `stalePendingFilter`); the organizations it belonged to, or null when it does not qualify. */
  async deleteStalePendingUser(
    id: string,
    cutoff: Date,
  ): Promise<string[] | null> {
    const deleted = await this.users
      .findOneAndDelete(
        { _id: id, ...stalePendingFilter(cutoff) },
        { projection: { organizations: 1 } },
      )
      .lean()
      .exec();
    return deleted ? (deleted.organizations ?? []).map(uuidStr) : null;
  }

  /** Free, or taken only by abandoned signups that registration would reclaim; looks at every case-insensitive match. */
  async isUsernameFree(username: string, cutoff: Date): Promise<boolean> {
    return !(await this.users
      .exists({ username, $nor: [stalePendingFilter(cutoff)] })
      .collation(CI)
      .exec());
  }

  /** Signups waiting for activation (resend): inactive, no ban, never logged in, not yet abandoned (`dateJoined` after `cutoff`). */
  findPendingByEmail(email: string, cutoff: Date): Promise<UserDocument[]> {
    return this.users
      .find({
        email,
        isActive: false,
        banReason: null,
        lastLogin: null,
        dateJoined: { $gte: cutoff },
      })
      .collation(CI)
      .exec();
  }

  /** False when the user is missing, already active or banned. */
  async activate(userId: string): Promise<boolean> {
    const { matchedCount } = await this.users
      .updateOne(
        { _id: userId, isActive: false, banReason: null },
        { $set: { isActive: true } },
      )
      .exec();
    return matchedCount === 1;
  }

  /** Compare-and-set on the ban reason: a ban set meanwhile is never overwritten or cleared; false when the reason was no longer `expectedReason`. */
  async updateIfBanReason(
    id: string,
    expectedReason: string | null,
    changes: Partial<User>,
  ): Promise<boolean> {
    const { matchedCount } = await this.users
      .updateOne({ _id: id, banReason: expectedReason }, { $set: changes })
      .exec();
    return matchedCount === 1;
  }

  async update(id: string, changes: Partial<User>): Promise<void> {
    await this.users.updateOne({ _id: id }, { $set: changes }).exec();
  }

  /** Compare-and-set: false when the stored hash is no longer `expectedHash`. */
  async updatePasswordIfUnchanged(
    id: string,
    expectedHash: string,
    newHash: string,
  ): Promise<boolean> {
    const { matchedCount } = await this.users
      .updateOne(
        { _id: id, password: expectedHash },
        { $set: { password: newHash } },
      )
      .exec();
    return matchedCount === 1;
  }

  /** CAS: false when `lastTotpTimecode` is no longer `previous` (code already consumed). */
  async advanceTotpTimecode(
    userId: string,
    previous: number,
    next: number,
  ): Promise<boolean> {
    const { matchedCount } = await this.users
      .updateOne(
        {
          _id: userId,
          isTotpEnabled: true,
          // legacy documents may lack the field; $in with null matches absence
          lastTotpTimecode: previous === 0 ? { $in: [0, null] } : previous,
        },
        { $set: { lastTotpTimecode: next } },
      )
      .exec();
    return matchedCount === 1;
  }

  /** CAS on the stored ciphertext: false when another request changed the scratch codes first. */
  async replaceScratchCodes(
    userId: string,
    expectedCiphertext: string | null,
    nextCiphertext: string | null,
  ): Promise<boolean> {
    const { matchedCount } = await this.users
      .updateOne(
        { _id: userId, scratchCodes: expectedCiphertext },
        { $set: { scratchCodes: nextCiphertext } },
      )
      .exec();
    return matchedCount === 1;
  }

  /** CAS: false when TOTP is already enabled (a racing confirm won). */
  async enableTotp(
    userId: string,
    fields: Pick<User, 'totpKey' | 'scratchCodes' | 'lastTotpTimecode'>,
  ): Promise<boolean> {
    const { matchedCount } = await this.users
      .updateOne(
        { _id: userId, isTotpEnabled: { $ne: true } },
        { $set: { ...fields, isTotpEnabled: true } },
      )
      .exec();
    return matchedCount === 1;
  }

  /** CAS: false when a handle was already stored (a racing request won). */
  async setWebauthnUserHandle(
    userId: string,
    handle: Buffer,
  ): Promise<boolean> {
    const { matchedCount } = await this.users
      .updateOne(
        { _id: userId, webauthnUserHandle: null },
        { $set: { webauthnUserHandle: handle } },
      )
      .exec();
    return matchedCount === 1;
  }

  async addWebauthnCredential(
    userId: string,
    credential: WebauthnCredential,
  ): Promise<void> {
    await this.users
      .updateOne(
        { _id: userId },
        {
          $push: { webauthnCredentials: credential },
          $set: { isWebauthnEnabled: true },
        },
      )
      .exec();
  }

  /** CAS: only moves the sign counter forward; false when the stored counter is not lower (replay or clone). */
  async updateWebauthnCounter(
    userId: string,
    credId: string,
    counter: number,
  ): Promise<boolean> {
    const { matchedCount } = await this.users
      .updateOne(
        {
          _id: userId,
          webauthnCredentials: {
            $elemMatch: { credId, counter: { $lt: counter } },
          },
        },
        { $set: { 'webauthnCredentials.$.counter': counter } },
      )
      .exec();
    return matchedCount === 1;
  }

  /** False when the user has no credential with this id. */
  async removeWebauthnCredential(
    userId: string,
    credentialId: string,
  ): Promise<boolean> {
    if (!isUuid(credentialId)) return false;
    // Match on the credential itself: timestamps make modifiedCount 1 even when nothing was pulled.
    const { matchedCount } = await this.users
      .updateOne(
        { _id: userId, 'webauthnCredentials._id': credentialId },
        { $pull: { webauthnCredentials: { _id: credentialId } } },
      )
      .exec();
    if (matchedCount !== 1) return false;
    await this.users
      .updateOne(
        { _id: userId, webauthnCredentials: { $size: 0 } },
        { $set: { isWebauthnEnabled: false } },
      )
      .exec();
    return true;
  }
}
