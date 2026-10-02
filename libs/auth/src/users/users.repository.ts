import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { CI, User } from '@libs/database';
import { HydratedDocument, Model } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class UsersRepository {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  async findById(id: string): Promise<UserDocument | null> {
    return UUID_PATTERN.test(id) ? this.users.findById(id).exec() : null;
  }

  findByUsername(username: string): Promise<UserDocument | null> {
    return this.users.findOne({ username }).collation(CI).exec();
  }

  findByEmail(email: string): Promise<UserDocument | null> {
    return this.users.findOne({ email }).collation(CI).exec();
  }

  create(fields: Partial<User>): Promise<UserDocument> {
    return this.users.create(fields);
  }

  async delete(id: string): Promise<void> {
    await this.users.deleteOne({ _id: id }).exec();
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
}
