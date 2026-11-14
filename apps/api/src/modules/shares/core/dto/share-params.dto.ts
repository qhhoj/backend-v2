import { IsString } from 'class-validator';

/** Unvalidated shape: an unknown code is a 404, never a 400. */
export class ShareCodeParamDto {
  /** Share code from `/c/<code>`; matched case-insensitively. */
  @IsString() code!: string;
}
