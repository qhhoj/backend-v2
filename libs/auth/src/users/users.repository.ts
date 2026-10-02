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

  async update(id: string, changes: Partial<User>): Promise<void> {
    await this.users.updateOne({ _id: id }, { $set: changes }).exec();
  }
}
