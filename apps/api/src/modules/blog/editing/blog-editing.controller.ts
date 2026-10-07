import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { RefuseNullFieldsPipe } from '@libs/common';
import { PostIdParamDto } from '../core/dto/post-params.dto';
import type { PostDetailResponse } from '../core/dto/post.response';
import { BlogEditingService } from './blog-editing.service';
import { CreatePostDto, UpdatePostDto } from './dto/post-edit.dto';

@Controller('api/internal/posts')
export class BlogEditingController {
  constructor(private readonly editing: BlogEditingService) {}

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreatePostDto,
  ): Promise<PostDetailResponse> {
    return this.editing.create(auth.principal, body);
  }

  @Patch(':id')
  edit(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: PostIdParamDto,
    @Body(new RefuseNullFieldsPipe()) body: UpdatePostDto,
  ): Promise<PostDetailResponse> {
    return this.editing.edit(auth.principal, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  delete(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: PostIdParamDto,
  ): Promise<void> {
    return this.editing.delete(auth.principal, id);
  }
}
