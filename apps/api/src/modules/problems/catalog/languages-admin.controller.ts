import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { RequirePermission } from '@libs/auth';
import { RefuseNullFieldsPipe } from '@libs/common';
import {
  CreateLanguageDto,
  LanguageIdParamDto,
  UpdateLanguageDto,
} from './dto/language-admin.dto';
import { LanguageAdminResponse } from './dto/language-admin.response';
import { LanguagesAdminService } from './languages-admin.service';

@Controller('api/internal/admin/languages')
export class LanguagesAdminController {
  constructor(private readonly languages: LanguagesAdminService) {}

  @RequirePermission('judge.change_language')
  @Get()
  list(): Promise<LanguageAdminResponse[]> {
    return this.languages.list();
  }

  @RequirePermission('judge.add_language')
  @Post()
  create(@Body() body: CreateLanguageDto): Promise<LanguageAdminResponse> {
    return this.languages.create(body);
  }

  @RequirePermission('judge.change_language')
  @Patch(':id')
  update(
    @Param() { id }: LanguageIdParamDto,
    @Body(new RefuseNullFieldsPipe(['shortName'])) body: UpdateLanguageDto,
  ): Promise<LanguageAdminResponse> {
    return this.languages.update(id, body);
  }
}
