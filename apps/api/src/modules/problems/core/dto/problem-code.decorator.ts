import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { PROBLEM_CODE_PATTERN, RESERVED_PROBLEM_CODES } from '@libs/database';
import { IsNotIn, Matches } from 'class-validator';

/** A code a new or renamed problem may take: the code pattern, minus the segments static routes own. The swagger plugin only reads a literal `@Matches`, so the pattern is documented here. */
export const IsProblemCode = (): PropertyDecorator =>
  applyDecorators(
    ApiProperty({ pattern: PROBLEM_CODE_PATTERN.source }),
    Matches(PROBLEM_CODE_PATTERN, {
      message: 'Only lowercase letters, digits and underscores (1-32).',
    }),
    IsNotIn(RESERVED_PROBLEM_CODES, { message: 'This code is reserved.' }),
  );
