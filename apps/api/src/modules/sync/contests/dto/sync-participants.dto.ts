import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsString,
  Length,
} from 'class-validator';
import { MAX_PARTICIPANTS } from '../rate-limits';

export class SyncParticipantsDto {
  /** Usernames of existing, active users; sync never creates a user. */
  // The plugin reads only literal limits, so the imported maximum is spelled out.
  @ApiProperty({
    type: [String],
    maxItems: MAX_PARTICIPANTS,
    uniqueItems: true,
  })
  @IsArray()
  @ArrayMaxSize(MAX_PARTICIPANTS)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 150, { each: true })
  usernames!: string[];
}
