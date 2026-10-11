import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, isDuplicateKey, ValidationFailedError } from '@libs/common';
import { RevisionsRepository } from '../../problems/core/revisions.repository';
import { USERNAME_TAKEN } from '../core/dto/username';
import { editableTarget } from './editable-target';

const usernameTaken = () =>
  new ValidationFailedError('Username taken', [USERNAME_TAKEN]);

/** Legacy admin username edit. Everything references users by id, so only the name changes; the old name keeps finding the profile (`previousUsernames`). */
@Injectable()
export class UserRenameService {
  constructor(
    private readonly users: UsersRepository,
    private readonly revisions: RevisionsRepository,
  ) {}

  /** A case-only change of the same account is allowed; a name another account holds is `username_taken`. */
  async rename(
    principal: Principal,
    username: string,
    next: string,
  ): Promise<{ username: string }> {
    const user = await editableTarget(this.users, principal, username, {
      notSelf: true,
    });
    if (next === user.username) return { username: next };
    const holder = await this.users.findByUsername(next, { _id: 1 });
    if (holder && holder._id !== user._id) throw usernameTaken();
    try {
      if (!(await this.users.rename(user._id, user.username, next)))
        throw new AppError('conflict', 409, 'The user was renamed meanwhile');
    } catch (error) {
      if (isDuplicateKey(error, 'username')) throw usernameTaken();
      throw error;
    }
    await this.revisions.append({
      entity: 'user',
      entityId: user._id,
      action: 'staff_rename',
      userId: principal.userId,
      changes: { username: { before: user.username, after: next } },
      comment: 'Username changed by staff',
    });
    return { username: next };
  }
}
