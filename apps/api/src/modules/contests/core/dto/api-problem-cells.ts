import { ApiProperty } from '@nestjs/swagger';

/** A `ProblemCell`: the format's flat map of numbers, flags and nulls. */
const problemCellSchema = () => ({
  type: 'object' as const,
  additionalProperties: {
    oneOf: [{ type: 'number' }, { type: 'boolean' }],
    nullable: true,
  },
});

/** `Record<problemId, ProblemCell>`. */
export const ApiProblemCells = () =>
  ApiProperty({ type: 'object', additionalProperties: problemCellSchema() });

/** One `ProblemCell`, or null. */
export const ApiProblemCell = () =>
  ApiProperty({ ...problemCellSchema(), nullable: true });
