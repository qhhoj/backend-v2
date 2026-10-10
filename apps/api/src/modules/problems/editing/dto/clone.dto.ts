import { IsProblemCode } from '../../core/dto/problem-code.decorator';

export class CloneProblemDto {
  /** Code of the new problem. */
  @IsProblemCode()
  code!: string;
}
