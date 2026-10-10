export class TotpEnrollmentResponse {
  /** The base32 TOTP secret for manual entry. */
  secret!: string;
  /** `otpauth://` URL to render as a QR code. */
  otpauthUrl!: string;
}

export class ScratchCodesResponse {
  /** One-time backup codes; shown only once. */
  scratchCodes!: string[];
}

export class ScratchCodesRemainingResponse {
  /** Number of unused scratch codes. */
  remaining!: number;
}
