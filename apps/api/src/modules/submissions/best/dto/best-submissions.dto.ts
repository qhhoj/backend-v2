import { PickType } from '@nestjs/swagger';
import { SubmissionListQueryDto } from '../../core/dto/submission-list.dto';

export class BestSubmissionsQueryDto extends PickType(SubmissionListQueryDto, [
  'page',
  'pageSize',
]) {}
