import { uuidStr } from '@libs/database';
import type { StaffUserRow } from '../user-admin.repository';

/** A user as the staff user list shows them: never an e-mail, a password hash or a second-factor secret. */
export class StaffUserResponse {
  /** User id. */
  id!: string;
  /** Login name. */
  username!: string;
  /** Contest rating; null while unrated. */
  rating!: number | null;
  /** Name to show: the staff-set override, else the username. */
  displayName!: string;
  /** Rank title such as `user`, `admin` or `banned`. */
  displayRank!: string;
  /** False for banned or never-activated accounts. */
  isActive!: boolean;
  /** Whether the user is staff. */
  isStaff!: boolean;
  /** Whether the user is a superuser. */
  isSuperuser!: boolean;
  /** Null unless banned. */
  banReason!: string | null;
  /** When the account was created. */
  dateJoined!: Date;
  /** Last time the user was seen; null if never. */
  lastAccess!: Date | null;

  static from(row: StaffUserRow): StaffUserResponse {
    return {
      id: uuidStr(row._id),
      username: row.username,
      rating: row.rating,
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
