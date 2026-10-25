import { ApiTags } from '@nestjs/swagger';
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

@ApiTags('Blog')
@Controller('api/internal/posts')
export class BlogEditingController {
  constructor(private readonly editing: BlogEditingService) {}

  /**
   * Create a blog post
   *
   * @remarks
   * Creates a personal post, or an organization post when `organization` (a
   * slug) is given. A personal post needs enough solved problems and an
   * unmuted account; an organization post needs an unmuted organization admin
   * holding `judge.edit_organization_post` (403 `forbidden`). `globalPost`
   * needs `judge.mark_global_post`, `sticky` needs `judge.pin_post`, and
   * `summary` and `ogImage` need `judge.edit_all_post`. Creating and editing
   * share a limit of 10 writes per hour (429 `rate_limited`); posts are locked
   * during an official contest. A revision is written, and a published
   * personal post is announced on Discord.
   */
  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreatePostDto,
  ): Promise<PostDetailResponse> {
    return this.editing.create(auth.principal, body);
  }

  /**
   * Edit a blog post
   *
   * @remarks
   * Changes the fields sent (null is refused). Allowed for the author,
   * organization admins and `judge.edit_all_post` holders; muted users cannot
   * edit. Authors can only be changed with `judge.edit_all_post`, and the flag
   * and staff fields follow the permissions listed for creating. A revision
   * records the difference. Hiding or showing a post alone with
   * `judge.edit_all_post` skips the write limit and the contest lock. A post
   * that a `judge.edit_all_post` holder other than its authors hid becomes
   * visible again only through `judge.edit_all_post` (403 otherwise).
   */
  @Patch(':id')
  edit(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: PostIdParamDto,
    @Body(new RefuseNullFieldsPipe()) body: UpdatePostDto,
  ): Promise<PostDetailResponse> {
    return this.editing.edit(auth.principal, id, body);
  }

  /**
   * Delete a blog post
   *
   * @remarks
   * Requires edit rights plus `judge.delete_blogpost`. Deletes the post with
   * its discussion, writes a revision and recomputes the contribution points
   * of the authors and commenters. Returns 204; 403 `forbidden` otherwise.
   */
  @Delete(':id')
  @HttpCode(204)
  delete(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: PostIdParamDto,
  ): Promise<void> {
    return this.editing.delete(auth.principal, id);
  }
}
