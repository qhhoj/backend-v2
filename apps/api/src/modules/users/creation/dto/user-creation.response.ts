/** A refusal of one row, in the shape of `error.issues[]`. */
export class UserRowIssueResponse {
  field!: string;
  code!: string;
  message!: string;
}

/** One row of a create request, in request order. */
export class CreatedUserResponse {
  username!: string;
  /** `created`, or `rejected` with `issues`. */
  status!: 'created' | 'rejected';
  /** The new account id; null when rejected. */
  id!: string | null;
  /** A generated password, shown only in this response; null when the row gave one, sent an invite or was rejected. */
  generatedPassword!: string | null;
  /** Whether an invite mail was sent. */
  invited!: boolean;
  issues!: UserRowIssueResponse[];
}
