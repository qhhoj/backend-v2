import { PROBLEM_CODE_PATTERN } from '@libs/database';
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsUUID,
  Matches,
  ValidateIf,
} from 'class-validator';

export const BULK_ACTIONS = [
  'archive',
  'unarchive',
  'add-tag',
  'remove-tag',
] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];
export const MAX_BULK_CODES = 100;

export class BulkProblemsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_CODES)
  @ArrayUnique()
  @Matches(PROBLEM_CODE_PATTERN, { each: true })
  codes!: string[];
  @ApiProperty({
    enum: BULK_ACTIONS,
    enumName: 'OrganizationProblemBulkAction',
  })
  @IsIn(BULK_ACTIONS)
  action!: BulkAction;
  @ValidateIf(
    (body: BulkProblemsDto) =>
      body.action === 'add-tag' || body.action === 'remove-tag',
  )
  @IsUUID('7')
  tagId?: string;
}
