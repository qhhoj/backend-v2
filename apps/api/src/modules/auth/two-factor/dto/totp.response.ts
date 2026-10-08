export class TotpEnrollmentResponse {
  secret!: string;
  otpauthUrl!: string;
}

export class ScratchCodesResponse {
  scratchCodes!: string[];
}
