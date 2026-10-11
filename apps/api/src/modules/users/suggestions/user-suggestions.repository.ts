import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { CI, User } from '@libs/database';
import type { Model } from 'mongoose';
import { usernamePrefixFilter } from '../core/username-prefix';

export type SuggestionRow = Pick<User, '_id' | 'username'>;

@Injectable()
export class UserSuggestionsRepository {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  /** The first `limit` usernames starting with `prefix`, in username order; only the id and the name are loaded. */
  byPrefix(prefix: string, limit: number): Promise<SuggestionRow[]> {
    return this.users
      .find(usernamePrefixFilter(prefix), { username: 1 }, { collation: CI })
      .sort({ username: 1 })
      .limit(limit)
      .lean<SuggestionRow[]>()
      .exec();
  }
}
