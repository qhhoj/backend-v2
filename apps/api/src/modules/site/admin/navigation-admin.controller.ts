import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { RequirePermission } from '@libs/auth';
import { RefuseNullFieldsPipe } from '@libs/common';
import { NavigationItemResponse } from '../public/dto/site.response';
import {
  CreateNavigationItemDto,
  UpdateNavigationItemDto,
} from './dto/navigation-admin.dto';
import { SiteIdParamDto } from './dto/site-admin-params.dto';
import { NavigationAdminService } from './navigation-admin.service';

/** No admin read: `GET /site` already lists every entry, hidden ones included, with their ids. */
@RequirePermission('judge.change_navigationbar')
@Controller('api/internal/admin/site/navigation')
export class NavigationAdminController {
  constructor(private readonly navigation: NavigationAdminService) {}

  @Post()
  create(
    @Body() body: CreateNavigationItemDto,
  ): Promise<NavigationItemResponse> {
    return this.navigation.create(body);
  }

  @Patch(':id')
  update(
    @Param() { id }: SiteIdParamDto,
    @Body(new RefuseNullFieldsPipe(['parentId'])) body: UpdateNavigationItemDto,
  ): Promise<NavigationItemResponse> {
    return this.navigation.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  delete(@Param() { id }: SiteIdParamDto): Promise<void> {
    return this.navigation.delete(id);
  }
}
