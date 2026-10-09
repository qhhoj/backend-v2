/** Legacy `VNOJ_INTERACT_MIN_PROBLEM_COUNT`. */
export const INTERACT_MIN_PROBLEM_COUNT = 5;
/** Longest `about` text of a profile or an organization. */
export const ABOUT_MAX_LENGTH = 65_536;

export interface Interactor {
  isStaff: boolean;
  isSuperuser: boolean;
  problemCount: number;
  mute: boolean;
}

/** Legacy `not is_new_user`. */
export const hasEnoughSolves = (user: Interactor): boolean =>
  user.isStaff ||
  user.isSuperuser ||
  user.problemCount >= INTERACT_MIN_PROBLEM_COUNT;

/** Editing `about`, commenting and voting: enough solves and not muted. */
export const canInteract = (user: Interactor): boolean =>
  !user.mute && hasEnoughSolves(user);
