import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { RequirePermission } from '@libs/auth';
import { RefuseNullFieldsPipe } from '@libs/common';
import {
  CreateJudgeDto,
  DisconnectJudgeDto,
  JudgeNameParamDto,
  UpdateJudgeDto,
} from './dto/judge.dto';
import {
  CreatedJudgeResponse,
  JudgeKeyResponse,
  JudgeResponse,
} from './dto/judge.response';
import { JudgesService } from './judges.service';

@RequirePermission('judge.change_judge')
@Controller('api/internal/judges')
export class JudgesController {
  constructor(private readonly judges: JudgesService) {}

  @Get()
  list(): Promise<JudgeResponse[]> {
    return this.judges.list();
  }

  @Post()
  create(@Body() dto: CreateJudgeDto): Promise<CreatedJudgeResponse> {
    return this.judges.create(dto);
  }

  @Patch(':name')
  update(
    @Param() { name }: JudgeNameParamDto,
    @Body(new RefuseNullFieldsPipe()) dto: UpdateJudgeDto,
  ): Promise<JudgeResponse> {
    return this.judges.update(name, dto);
  }

  @Post(':name/key')
  @HttpCode(200)
  rotateKey(@Param() { name }: JudgeNameParamDto): Promise<JudgeKeyResponse> {
    return this.judges.rotateKey(name);
  }

  @Post(':name/disconnect')
  @HttpCode(204)
  disconnect(
    @Param() { name }: JudgeNameParamDto,
    @Body() { force }: DisconnectJudgeDto,
  ): Promise<void> {
    return this.judges.disconnect(name, force);
  }
}
