import { uuidStr } from '@libs/database';
import type { StaffUserRow } from '../user-admin.repository';

/** A user as the staff user list shows them: never an e-mail, a password hash or a second-factor secret. */
export class StaffUserResponse {
  id!: string;
  username!: string;
  displayName!: string;
  displayRank!: string;
  isActive!: boolean;
  isStaff!: boolean;
  isSuperuser!: boolean;
  /** Null unless banned. */
  banReason!: string | null;
  dateJoined!: Date;
  lastAccess!: Date | null;

  static from(row: StaffUserRow): StaffUserResponse {
    return {
      id: uuidStr(row._id),
      username: row.username,
      displayName: row.usernameDisplayOverride || row.username,
      displayRank: row.displayRank,
      isActive: row.isActive,
      isStaff: row.isStaff,
      isSuperuser: row.isSuperuser,
      banReason: row.banReason,
      dateJoined: row.dateJoined,
      lastAccess: row.lastAccess,
    };
  }
}
