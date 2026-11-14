export class ActivationResponse {
  /** A password-reset link was mailed: the password chosen at signup no longer works, and the account sets one through that link. False when the account had no such password, or the mail could not be sent (the reset form sends another). */
  passwordResetSent!: boolean;
  /** The password chosen at signup was voided and no longer signs in, whether or not the reset mail went out. False when the account had no such password. */
  passwordVoided!: boolean;
}
