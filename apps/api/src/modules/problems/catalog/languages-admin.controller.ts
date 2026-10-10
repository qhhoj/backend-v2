import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@libs/auth';
import { RefuseNullFieldsPipe } from '@libs/common';
import {
  CreateLanguageDto,
  LanguageIdParamDto,
  UpdateLanguageDto,
} from './dto/language-admin.dto';
import { LanguageAdminResponse } from './dto/language-admin.response';
import { LanguagesAdminService } from './languages-admin.service';

@ApiTags('Admin: judges & languages')
@Controller('api/internal/admin/languages')
export class LanguagesAdminController {
  constructor(private readonly languages: LanguagesAdminService) {}

  /**
   * List judge languages with their full settings
   *
   * @remarks
   * Needs `judge.change_language`. Returns every programming language of the
   * site, sorted by name, including editor, highlighting and file-size settings
   * that the public catalog omits.
   */
  @RequirePermission('judge.change_language')
  @Get()
  list(): Promise<LanguageAdminResponse[]> {
    return this.languages.list();
  }

  /**
   * Add a judge language
   *
   * @remarks
   * Needs `judge.add_language`. The `key` is what judges report for the language
   * and cannot be changed afterwards. Responds 409 `conflict` when the key
   * already exists. The change takes effect on this server at once and on others
   * through the change stream.
   */
  @RequirePermission('judge.add_language')
  @Post()
  create(@Body() body: CreateLanguageDto): Promise<LanguageAdminResponse> {
    return this.languages.create(body);
  }

  /**
   * Update a judge language
   *
   * @remarks
   * Needs `judge.change_language`. Send only the fields to change;
   * `shortName: null` clears the short name and every other field refuses null.
   * The `key` cannot be changed. Responds 404 `not_found` for an unknown id.
   */
  @RequirePermission('judge.change_language')
  @Patch(':id')
  update(
    @Param() { id }: LanguageIdParamDto,
    @Body(new RefuseNullFieldsPipe(['shortName'])) body: UpdateLanguageDto,
  ): Promise<LanguageAdminResponse> {
    return this.languages.update(id, body);
  }
}
