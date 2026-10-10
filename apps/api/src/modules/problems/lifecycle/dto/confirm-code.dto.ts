import { IsString } from 'class-validator';

/** The problem's code, typed again by the person deleting or purging it. */
export class ConfirmCodeDto {
  /** The problem code, typed again to confirm. */
  @IsString() confirmCode!: string;
}
