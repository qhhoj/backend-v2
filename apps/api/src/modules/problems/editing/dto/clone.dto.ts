import { IsProblemCode } from '../../core/dto/problem-code.decorator';

export class CloneProblemDto {
  @IsProblemCode()
  code!: string;
}
