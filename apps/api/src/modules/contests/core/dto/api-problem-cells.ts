import { ApiProperty } from '@nestjs/swagger';

/** `Record<problemId, ProblemCell>`: a cell is the format's flat map of numbers, flags and nulls. */
export const ApiProblemCells = () =>
  ApiProperty({
    type: 'object',
    additionalProperties: {
      type: 'object',
      additionalProperties: {
        oneOf: [{ type: 'number' }, { type: 'boolean' }],
        nullable: true,
      },
    },
  });
