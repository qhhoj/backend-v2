import type { UserDocument } from '@libs/auth';
import type { User } from '@libs/database';
import { renderField } from '../../problems/editing/problem-markup';
import type { UpdateUserByStaffDto } from './dto/user-edit.dto';

export type Changes = Record<string, { before: unknown; after: unknown }>;

/** Request field → stored field, for the fields written as given. */
const PLAIN_FIELDS = {
  displayName: 'usernameDisplayOverride',
  fullName: 'firstName',
  displayRank: 'displayRank',
  isUnlisted: 'isUnlisted',
  mute: 'mute',
  allowTagging: 'allowTagging',
  notes: 'notes',
} as const satisfies Partial<Record<keyof UpdateUserByStaffDto, keyof User>>;

/** The plain profile fields that differ from the stored user: the write and its audit entry. `about` is logged by length, never its text. Pure. */
export function fieldChanges(
  user: UserDocument,
  dto: UpdateUserByStaffDto,
): { fields: Partial<User>; changes: Changes } {
  const fields: Record<string, unknown> = {};
  const changes: Changes = {};
  for (const [key, stored] of Object.entries(PLAIN_FIELDS)) {
    const next = dto[key as keyof typeof PLAIN_FIELDS];
    const before = user[stored] ?? '';
    if (next === undefined || next === before) continue;
    fields[stored] = next;
    changes[key] = { before, after: next };
  }
  const about = user.about ?? '';
  if (dto.about !== undefined && dto.about !== about) {
    Object.assign(fields, {
      about: dto.about,
      aboutHtml: renderField(dto.about, 'user', 'about'),
    });
    changes.about = { before: about.length, after: dto.about.length };
  }
  if (dto.leaveCurrentContest && user.currentParticipation !== null) {
    fields.currentParticipation = null;
    changes.currentParticipation = {
      before: user.currentParticipation,
      after: null,
    };
  }
  return { fields: fields, changes };
}
