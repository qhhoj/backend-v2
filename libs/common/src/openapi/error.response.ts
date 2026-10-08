import { ApiPropertyOptional } from '@nestjs/swagger';

export class FieldIssueResponse {
  field!: string;
  /** Machine code, snake_case. */
  code!: string;
  message!: string;
}

export class ErrorBodyResponse {
  /** Machine code, snake_case (`validation_failed`, `not_found`, ...). */
  code!: string;
  message!: string;
  /** Present on validation errors: messages per field. */
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'array', items: { type: 'string' } },
  })
  fields?: Record<string, string[]>;
  /** Present on validation errors: the same failures with machine codes. */
  @ApiPropertyOptional({ type: [FieldIssueResponse] })
  issues?: FieldIssueResponse[];
}

/** Every non-2xx answer; some errors add members of their own next to these. */
export class ErrorResponse {
  error!: ErrorBodyResponse;
}
