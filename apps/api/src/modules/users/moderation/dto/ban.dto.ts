import { IsString, Length, Matches } from 'class-validator';

export const BAN_REASON_MAX_LENGTH = 4096;

export class BanDto {
  /**
   * Why the user is banned; shown to the user at sign-in and to staff. Must not be blank.
   */
  @IsString()
  @Length(1, BAN_REASON_MAX_LENGTH)
  @Matches(/\S/)
  reason!: string;
}
