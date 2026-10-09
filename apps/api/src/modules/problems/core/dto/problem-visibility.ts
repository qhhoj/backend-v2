import { ApiProperty } from '@nestjs/swagger';
import {
  SUBMISSION_SOURCE_VISIBILITIES,
  TESTCASE_RESULT_VISIBILITIES,
  TESTCASE_VISIBILITIES,
} from '@libs/database';

/** The three visibility codes, each a named enum in the document so the create, update and detail shapes share one type. */
export const ApiSubmissionSourceVisibility = (required = true) =>
  ApiProperty({
    enum: SUBMISSION_SOURCE_VISIBILITIES,
    enumName: 'SubmissionSourceVisibility',
    required,
  });
export const ApiTestcaseVisibility = (required = true) =>
  ApiProperty({
    enum: TESTCASE_VISIBILITIES,
    enumName: 'TestcaseVisibility',
    required,
  });
export const ApiTestcaseResultVisibility = (required = true) =>
  ApiProperty({
    enum: TESTCASE_RESULT_VISIBILITIES,
    enumName: 'TestcaseResultVisibility',
    required,
  });
